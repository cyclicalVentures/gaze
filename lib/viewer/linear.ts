/** Partial-pivot Gaussian elimination for the small calibration normal equations. */
export function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length, a = matrix.map((row, i) => [...row, rhs[i]]);
  if (matrix.length !== n || matrix.some(row => row.length !== n) || !a.flat().every(Number.isFinite)) return null;
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (Math.abs(a[pivot][column]) < 1e-10) return null;
    [a[pivot], a[column]] = [a[column], a[pivot]];
    const divisor = a[column][column];
    for (let j = column; j <= n; j++) a[column][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = a[row][column];
      for (let j = column; j <= n; j++) a[row][j] -= factor * a[column][j];
    }
  }
  const result = a.map(row => row[n]);
  return result.every(Number.isFinite) ? result : null;
}
export const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
