import { LitElement, html, css } from "lit";
import { trackLitUpdates } from "tuppence/lit";
import { assignTrackGroup } from "tuppence";

export class AcmeElement extends LitElement {
  constructor() {
    super();
    trackLitUpdates(this);
  }
}

assignTrackGroup(AcmeElement, "Acme Design System");

const work = (ms) => {
  const end = performance.now() + ms;
  while (performance.now() < end) {}
};

class AcmeTable extends AcmeElement {
  static properties = {
    columns: { attribute: false },
    rows: { attribute: false },
  };
  static styles = css`
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line, #ddd); }
    th { font-weight: 600; }
  `;
  constructor() {
    super();
    this.columns = [];
    this.rows = [];
  }
  render() {
    work(6);
    return html`<table>
      <thead><tr>${this.columns.map((c) => html`<th>${c.label}</th>`)}</tr></thead>
      <tbody>${this.rows.map((r) => html`<tr>${this.columns.map((c) => html`<td>${r[c.key]}</td>`)}</tr>`)}</tbody>
    </table>`;
  }
}
customElements.define("acme-table", AcmeTable);

class AcmeBadge extends AcmeElement {
  static properties = { count: { type: Number } };
  static styles = css`
    span { display: inline-block; min-width: 1.5em; padding: 2px 8px; border-radius: 999px;
      background: #3b5bdb; color: white; font-size: 13px; text-align: center; }
  `;
  constructor() {
    super();
    this.count = 0;
  }
  render() {
    work(1);
    return html`<span>${this.count}</span>`;
  }
}
customElements.define("acme-badge", AcmeBadge);
