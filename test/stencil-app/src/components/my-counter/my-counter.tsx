import { Component, Prop, State, h } from '@stencil/core';

const work = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) {} };

@Component({ tag: 'my-counter', shadow: true })
export class MyCounter {
  @State() count = 0;
  @Prop() label = 'count';
  // Real work in each step, so every timing is long enough to measure.
  constructor() { work(0.3); }
  connectedCallback() { work(1); }
  componentWillUpdate() { work(0.5); }
  componentDidUpdate() { work(2); }
  render() {
    work(3);
    return <button onClick={() => this.count++}>{this.label}: {this.count} <my-badge value={this.count}></my-badge></button>;
  }
}

