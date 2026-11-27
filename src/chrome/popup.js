const btn = document.getElementById("copy-ext-url");
const statusEl = document.getElementById("copy-status");

if (btn && statusEl) {
  btn.addEventListener("click", async () => {
    const url = "chrome://extensions";
    try {
      await navigator.clipboard.writeText(url);
      statusEl.textContent = "Copied — paste in address bar";
    } catch {
      statusEl.textContent = "Type chrome://extensions in address bar";
    }
  });
}
