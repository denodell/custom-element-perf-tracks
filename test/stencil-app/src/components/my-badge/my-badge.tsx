import { Component, Prop, h } from '@stencil/core';

const work = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) {} };

@Component({ tag: 'my-badge', shadow: true })
export class MyBadge {
  @Prop() value = 0;
  // Real work in each step, so every timing is long enough to measure.
  constructor() { work(0.3); }
  connectedCallback() { work(0.5); }
  render() { work(1); return <b>{this.value}</b>; }
}
