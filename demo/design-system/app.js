import "./acme.js";
import { createElement as h, useState, useMemo } from "react";
import { createRoot } from "react-dom/client";

const PRODUCTS = Array.from({ length: 40 }, (_, i) => ({
  name: `Product ${i + 1}`,
  price: `£${(9.99 + i * 2.5).toFixed(2)}`,
  stock: (i * 7) % 23,
}));

function App() {
  const [cart, setCart] = useState(0);
  const [fixed, setFixed] = useState(false);

  // The mistake: a new array on every render.
  const inlineColumns = [
    { key: "name", label: "Product" },
    { key: "price", label: "Price" },
    { key: "stock", label: "In stock" },
  ];
  // The fix: the same array is reused.
  const memoColumns = useMemo(() => inlineColumns, []);

  return h(
    "main",
    null,
    h("h1", null, "Acme shop"),
    h(
      "p",
      { className: "lede" },
      "A React app using a design system built with Lit. Record in the Performance panel, click ",
      h("b", null, "Add to cart"),
      " a few times, then stop. Open the ",
      h("b", null, "Acme Design System"),
      " group: each table render is yellow, marked as a wasted render, because the app passes a new ",
      h("code", null, "columns"),
      " array every time.",
    ),
    h(
      "div",
      { className: "bar" },
      h("button", { id: "add", onClick: () => setCart((c) => c + 1) }, "Add to cart"),
      h("span", null, "Cart ", h("acme-badge", { count: cart })),
      h(
        "label",
        null,
        h("input", { id: "fix", type: "checkbox", checked: fixed, onChange: (e) => setFixed(e.target.checked) }),
        " Fix it: reuse the columns array",
      ),
    ),
    h("acme-table", { columns: fixed ? memoColumns : inlineColumns, rows: PRODUCTS }),
  );
}

createRoot(document.getElementById("root")).render(h(App));
