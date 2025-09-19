/* eslint-env node */
// Entry point for NRE. Keep it simple while we scaffold the app.

function greet(name) {
  return `Hello, ${name}!`;
}

const output = greet("NRE");
console.log(output);
