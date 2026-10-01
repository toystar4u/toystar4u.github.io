// 암호 관리자가 **두 칸을 한꺼번에** 채우게 만드는 보정.
//
// Flutter Web 은 자동 채우기 그룹의 칸들을 숨은 <form> 안의 <input> 으로
// 만드는데, **편집 중이 아닌 칸은 0x0 크기**로 둔다(엔진의 text_editing).
// 브라우저는 크기가 0 인 입력란을 보이지 않는 것으로 보고 자동 채우기에서
// 건너뛴다. 그래서 iOS 에서 아이디 칸을 채우면 아이디만, 비밀번호 칸을
// 채우면 비밀번호만 들어오고 Face ID 를 두 번 하게 된다.
//
// 0x0 인 칸에만 1x1 을 준다. 이미 color/caret-color 가 transparent 이고
// 부모 폼도 투명이라 보이는 것은 달라지지 않는다.
//
// **편집 중인 칸은 건드리지 않는다.** 그 칸은 엔진이 실제 입력란 위치에
// 맞춰 크기를 잡아 두는데, 거기에 손대면 키보드/IME 위치가 틀어진다.
//
// 엔진이 만든 DOM 을 고치는 것이므로 Flutter 를 올릴 때 다시 확인할 것.
// 이 파일만 지우면 원래 동작으로 돌아간다.
(function () {
  'use strict';

  function patch() {
    document.querySelectorAll('form.transparentTextEditing').forEach(
      function (form) {
        // 칸을 담은 폼 자체가 0x0 이다. 브라우저가 폼 단위로 "채울 만한
        // 양식인가" 를 따진다면 칸만 키워서는 소용이 없다.
        var fr = form.getBoundingClientRect();
        if (fr.width <= 0 || fr.height <= 0) {
          form.style.setProperty('width', '1px', 'important');
          form.style.setProperty('height', '1px', 'important');
        }

        form.querySelectorAll('input').forEach(function (input) {
          if (input === document.activeElement) return;
          if (input.type === 'submit') return;
          var r = input.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return;
          input.style.setProperty('width', '1px', 'important');
          input.style.setProperty('height', '1px', 'important');
        });
      });
  }

  // 폼은 칸에 포커스가 갈 때마다 새로 만들어진다. 생길 때마다 손봐야 한다.
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      patch();
    });
  }

  new MutationObserver(schedule)
    .observe(document.documentElement, { childList: true, subtree: true });

  // 포커스가 옮겨가면 아까 편집 중이던 칸이 0x0 으로 바뀐다.
  document.addEventListener('focusin', schedule, true);
  document.addEventListener('focusout', schedule, true);
})();
