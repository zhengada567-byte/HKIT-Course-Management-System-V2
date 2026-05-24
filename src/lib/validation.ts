export function required(value: unknown, message = "Required") {
  if (value === null || value === undefined || String(value).trim() === "") {
    return message;
  }

  return null;
}

export function nonNegativeNumber(value: unknown, message = "Must be >= 0") {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const num = Number(value);

  if (Number.isNaN(num) || num < 0) {
    return message;
  }

  return null;
}

export function positiveInteger(value: unknown, message = "Must be > 0") {
  const num = Number(value);

  if (!Number.isInteger(num) || num <= 0) {
    return message;
  }

  return null;
}
