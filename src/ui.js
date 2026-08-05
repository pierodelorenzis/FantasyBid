export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => document.querySelectorAll(selector);

export function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2500);
}

export function renderIcons() {
  window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
}

export const money = (amount) => "ƒ " + amount;

export function initials(name) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
