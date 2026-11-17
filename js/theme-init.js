/* Runs before first paint (loaded synchronously in <head>) so there is no flash of the wrong theme.
   Preferences are stored by core/util.js as JSON under the "toolora:" prefix. */
(function () {
  try {
    var saved = JSON.parse(localStorage.getItem('toolora:theme'));
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
