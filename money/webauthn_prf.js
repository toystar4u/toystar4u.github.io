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

  function fail(message) {
    return JSON.stringify({ ok: false, error: message });
  }

  function randomChallenge() {
    return crypto.getRandomValues(new Uint8Array(32));
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
  window.scPrfRegister = async function (userIdB64, userName, saltB64) {
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
          // eval 을 같이 보내면 만드는 김에 PRF 값까지 주는 브라우저가 있다.
          // 그러면 Face ID 를 한 번만 묻는다. 안 주면 아래에서 한 번 더 묻는다.
          extensions: { prf: { eval: { first: salt } } },
        },
      });
      if (!cred) return fail('패스키를 만들지 못했습니다.');

      const ext = cred.getClientExtensionResults();
      if (!ext || !ext.prf || ext.prf.enabled !== true) {
        return fail('이 기기는 보안카드 잠금해제에 필요한 PRF 확장을 지원하지 않습니다.');
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
      const second = await window.scPrfAuthenticate(credentialId, saltB64);
      const parsed = JSON.parse(second);
      if (!parsed.ok) return second;
      return JSON.stringify({
        ok: true,
        credentialId: credentialId,
        prf: parsed.prf,
      });
    } catch (e) {
      return fail(describe(e));
    }
  };

  /// 등록해 둔 패스키로 PRF 값을 다시 받아 온다. 여기서 Face ID 가 뜬다.
  window.scPrfAuthenticate = async function (credentialIdB64, saltB64) {
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: randomChallenge(),
          allowCredentials: [{
            type: 'public-key',
            id: b64urlToBytes(credentialIdB64),
          }],
          userVerification: 'required',
          timeout: 120000,
          extensions: { prf: { eval: { first: b64urlToBytes(saltB64) } } },
        },
      });
      if (!assertion) return fail('인증이 취소되었습니다.');

      const ext = assertion.getClientExtensionResults();
      if (!ext || !ext.prf || !ext.prf.results || !ext.prf.results.first) {
        return fail('인증기가 열쇠를 내주지 않았습니다. 암호로 열어 주세요.');
      }
      return JSON.stringify({
        ok: true,
        prf: bytesToB64url(ext.prf.results.first),
      });
    } catch (e) {
      return fail(describe(e));
    }
  };

  function describe(e) {
    const name = e && e.name ? e.name : '';
    if (name === 'NotAllowedError') return '인증이 취소되었거나 시간이 지났습니다.';
    if (name === 'InvalidStateError') return '이 기기에는 이미 등록되어 있습니다.';
    if (name === 'NotSupportedError') return '이 브라우저는 지원하지 않습니다.';
    if (name === 'SecurityError') return '보안 컨텍스트가 아닙니다 (https 필요).';
    return (e && e.message) ? e.message : '알 수 없는 오류';
  }
})();
