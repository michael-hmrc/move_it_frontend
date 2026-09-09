const conditionalSelects = document.querySelectorAll('[data-module="app-conditional-select"]');

for (const select of conditionalSelects) {
  const controlledId = select.getAttribute("aria-controls");
  const conditionalValue = select.getAttribute("data-conditional-value");
  const controlledElement = controlledId ? document.getElementById(controlledId) : null;

  if (!(select instanceof HTMLSelectElement) || !controlledElement || !conditionalValue) continue;

  const updateConditionalElement = () => {
    controlledElement.classList.toggle(
      "app-select-conditional--hidden",
      select.value !== conditionalValue
    );
  };

  select.addEventListener("change", updateConditionalElement);
  updateConditionalElement();
}
