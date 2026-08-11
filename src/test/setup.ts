let objectUrlId = 0;

Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  value: () => `blob:tactile-${objectUrlId++}`,
});

Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  value: () => undefined,
});
