document.querySelectorAll("pre:not(.mermaid)").forEach((pre) => {
  const btn = document.createElement("button");
  btn.className = "copy-btn";
  btn.textContent = "Copy";
  btn.addEventListener("click", () => {
    const code = pre.querySelector("code");
    if (code) {
      navigator.clipboard.writeText(code.textContent || "");
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    }
  });
  pre.appendChild(btn);
});
