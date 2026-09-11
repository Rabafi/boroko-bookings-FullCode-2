export function childProcessExitCode(result) {
  return Number.isInteger(result?.status) && result.status >= 0 ? result.status : 1
}
