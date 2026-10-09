// Single source of truth for the public website build number.
// For every future website release, change only WEBSITE_BUILD here.
(() => {
  'use strict';
  const WEBSITE_BUILD = 238;
  const label = `Website Build ${WEBSITE_BUILD}`;
  document.querySelectorAll('[data-rebatatrack-website-build]').forEach((element) => {
    element.setAttribute('data-rebatatrack-website-build', String(WEBSITE_BUILD));
    element.textContent = label;
  });
})();
