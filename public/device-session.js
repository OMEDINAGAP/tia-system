(() => {
  const key = "tia_device_id";
  let deviceId = localStorage.getItem(key);
  if (!deviceId) {
    deviceId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16)}`;
    localStorage.setItem(key, deviceId);
  }
  window.TIADevice = { id: deviceId };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    const authorization = headers.get("Authorization") || "";
    if (/^Bearer\s+(?!admin-)/i.test(authorization)) headers.set("X-TIA-Device", deviceId);
    return nativeFetch(input, { ...init, headers });
  };
})();
