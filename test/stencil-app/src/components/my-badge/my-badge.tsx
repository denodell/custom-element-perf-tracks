import { Component, Prop, h } from '@stencil/core';

const work = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) {} };

@Component({ tag: 'my-badge', shadow: true })
export class MyBadge {
  @Prop() value = 0;
  connectedCallback() { work(0.5); }
  render() { work(1); return <b>{this.value}</b>; }
}
