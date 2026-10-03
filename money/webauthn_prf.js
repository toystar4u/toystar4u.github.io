// 보안카드를 Face ID / 지문으로 여는 데 쓰는 WebAuthn PRF 래퍼.
//
// 여기서 WebAuthn 은 **인증 프로토콜이 아니라 열쇠 보관함**으로 쓴다. 서버가
// 서명을 검증하지 않으므로 challenge 는 로컬에서 만든 난수다. 우리가 기대는
// 성질은 딱 하나다 — **인증기는 사용자 확인(Face ID) 없이 PRF 값을 내주지
// 않는다.** 그 값으로 금고 열쇠를 풀어낸다.
//
// PRF 출력은 (인증기 비밀 × 소금) 으로 정해지는 32바이트다. 기기를 떠나지
// 않으며, iCloud 키체인으로 동기화된 패스키라면 같은 값이 다른 기기에서도
// 나온다.
//
// Dart 쪽 interop 을 단순하게 두려고 **모든 함수가 JSON 문자열을 돌려준다.**
// 성공은 {"ok":true,...}, 실패는 {"ok":false,"error":"..."} 다.
(function () {
  'use strict';

  function b64urlToBytes(s) {
    const pad = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(pad + '==='.slice((pad.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64url(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // `code` 는 Dart 가 **조용히 넘어갈 실패와 알려야 할 실패**를 가르는 데 쓴다.
  // 사용자가 Face ID 를 통과한 뒤의 실패까지 삼키면 고장 원인이 안 보인다.
  function fail(message, code) {
    return JSON.stringify({ ok: false, error: message, code: code || 'Error' });
  }

  function randomChallenge() {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  // 쉼표로 이어 붙인 base64url id 목록을 WebAuthn 서술자 배열로 바꾼다.
  // base64url 알파벳에 쉼표가 없으므로 이 구분자는 안전하다.
  //
  // **`transports` 를 넣지 말 것.** 한 번 `['internal']` 로 좁혀 봤는데,
  // 갤럭시에서 **방금 만든 패스키를 다시 찾지 못해** 등록이 "사용 가능한
  // 패스키가 없습니다" 로 끝났다. 안드로이드 패스키는 Google 비밀번호
  // 관리자에 들어가고 그 전송 방식이 `internal` 하나로 보고되지 않는다.
  //
  // 원래 좁히려던 이유(QR 전송 창이 뜨는 것)는 **모르는 기기에서 자동으로
  // `get()` 을 부르지 않는 것**으로 이미 해결했다. 추측으로 범위를 좁히는
  // 쪽이 더 비쌌다.
  function toDescriptors(csv) {
    if (!csv) return [];
    return csv.split(',').filter(function (s) { return s.length > 0; })
        .map(function (id) {
          return { type: 'public-key', id: b64urlToBytes(id) };
        });
  }

  /// 이 브라우저에서 플랫폼 인증기(Face ID / 지문)를 쓸 수 있는지.
  ///
  /// PRF 지원 여부는 실제로 등록해 보기 전에는 알 수 없다. 그래서 여기서는
  /// 플랫폼 인증기 유무까지만 보고, PRF 는 등록 단계에서 확인한다.
  window.scPrfSupported = async function () {
    try {
      if (!window.PublicKeyCredential ||
          !window.isSecureContext ||
          !navigator.credentials) {
        return JSON.stringify({ ok: true, supported: false });
      }
      const available = await PublicKeyCredential
          .isUserVerifyingPlatformAuthenticatorAvailable();
      return JSON.stringify({ ok: true, supported: available === true });
    } catch (e) {
      return JSON.stringify({ ok: true, supported: false });
    }
  };

  /// 패스키를 만들고 PRF 값을 받아 온다.
  ///
  /// `excludeIdsCsv` 는 이미 등록해 둔 자격증명들이다. 같은 인증기에 두 번
  /// 만드는 것을 막는다 — 특히 iCloud 키체인으로 **동기화된 패스키**가 이미
  /// 이 기기에 와 있는 경우가 그렇다. 그때는 등록이 필요 없고 이미 열린다.
  window.scPrfRegister = async function (
      userIdB64, userName, saltB64, excludeIdsCsv) {
    try {
      const salt = b64urlToBytes(saltB64);
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: randomChallenge(),
          rp: { name: '보안카드', id: location.hostname },
          user: {
            id: b64urlToBytes(userIdB64),
            name: userName,
            displayName: userName,
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },   // ES256
            { type: 'public-key', alg: -257 }, // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            residentKey: 'required',
            userVerification: 'required',
          },
          timeout: 120000,
          excludeCredentials: toDescriptors(excludeIdsCsv),
          // eval 을 같이 보내면 만드는 김에 PRF 값까지 주는 브라우저가 있다.
          // 그러면 Face ID 를 한 번만 묻는다. 안 주면 아래에서 한 번 더 묻는다.
          extensions: { prf: { eval: { first: salt } } },
        },
      });
      if (!cred) return fail('패스키를 만들지 못했습니다.', 'NoCredential');

      const ext = cred.getClientExtensionResults();
      if (!ext || !ext.prf || ext.prf.enabled !== true) {
        return fail('이 기기는 보안카드 잠금해제에 필요한 PRF 확장을 지원하지 않습니다.',
            'PrfUnsupported');
      }

      const credentialId = bytesToB64url(cred.rawId);
      if (ext.prf.results && ext.prf.results.first) {
        return JSON.stringify({
          ok: true,
          credentialId: credentialId,
          prf: bytesToB64url(ext.prf.results.first),
        });
      }

      // 만들기 단계에서 값을 안 준 경우. 바로 한 번 더 물어서 받아 온다.
      //
      // **여기서 실패하면 패스키는 이미 만들어져 있다.** 그 사실을 메시지에
      // 담는다 — 안 그러면 만들기가 실패한 것과 구분이 안 되고, 실기기
      // 보고만으로는 어느 단계인지 알 수 없다. 실제로 그래서 한 번 헤맸다.
      const second = await window.scPrfAuthenticate(credentialId, saltB64);
      const parsed = JSON.parse(second);
      if (!parsed.ok) {
        return fail('패스키는 만들었지만 열쇠를 받지 못했습니다: ' + parsed.error,
            'PrfAfterCreate');
      }
      return JSON.stringify({
        ok: true,
        credentialId: credentialId,
        prf: parsed.prf,
      });
    } catch (e) {
      return fail(describe(e), e && e.name ? e.name : 'Error');
    }
  };

  /// 등록해 둔 패스키로 PRF 값을 다시 받아 온다. 여기서 Face ID 가 뜬다.
  ///
  /// `credentialIdsCsv` 에는 **등록된 기기 전부**를 넣는다. 어느 기기에서
  /// 부르는지 미리 알 수 없으므로, 인증기가 자기가 가진 것으로 응답하게
  /// 두고 **응답에 담긴 id 로 어느 기기였는지 알아낸다.**
  ///
  /// 소금은 하나뿐이다. PRF 의 `eval` 은 골라진 자격증명이 무엇이든 같은
  /// 소금을 먹이므로 그래도 된다. 출력은 인증기 비밀로 갈리기 때문에 기기마다
  /// 다른 값이 나온다.
  window.scPrfAuthenticate = async function (credentialIdsCsv, saltB64) {
    try {
      const allow = toDescriptors(credentialIdsCsv);
      if (allow.length === 0) return fail('등록된 기기가 없습니다.', 'NoCredential');

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: randomChallenge(),
          allowCredentials: allow,
          userVerification: 'required',
          timeout: 120000,
          extensions: { prf: { eval: { first: b64urlToBytes(saltB64) } } },
        },
      });
      if (!assertion) return fail('인증이 취소되었습니다.', 'NotAllowedError');

      const ext = assertion.getClientExtensionResults();
      if (!ext || !ext.prf || !ext.prf.results || !ext.prf.results.first) {
        return fail('인증기가 열쇠를 내주지 않았습니다. 암호로 열어 주세요.', 'NoPrf');
      }
      return JSON.stringify({
        ok: true,
        credentialId: bytesToB64url(assertion.rawId),
        prf: bytesToB64url(ext.prf.results.first),
      });
    } catch (e) {
      return fail(describe(e), e && e.name ? e.name : 'Error');
    }
  };

  function describe(e) {
    const name = e && e.name ? e.name : '';
    if (name === 'NotAllowedError') return '인증이 취소되었거나 시간이 지났습니다.';
    // excludeCredentials 에 걸렸다는 뜻이다. 오류가 아니라 "이미 된다" 다.
    // iCloud 키체인으로 동기화된 패스키가 와 있는 경우가 대표적이다.
    if (name === 'InvalidStateError') {
      return '이 기기는 이미 등록된 기기로 열 수 있습니다. 바로 Face ID 로 열어 보세요.';
    }
    if (name === 'NotSupportedError') return '이 브라우저는 지원하지 않습니다.';
    if (name === 'SecurityError') return '보안 컨텍스트가 아닙니다 (https 필요).';
    return (e && e.message) ? e.message : '알 수 없는 오류';
  }
})();
