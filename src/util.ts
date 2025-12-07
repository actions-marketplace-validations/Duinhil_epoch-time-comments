export function ReplaceEpochTimes(
  line: string,
  minEpoch: number,
  maxLineLength: number
): string {
  function replaceEpochTimes(match: string): string {
    const epoch = parseInt(match)
    if (epoch >= minEpoch) {
      const date = new Date(0)
      date.setUTCSeconds(epoch)
      return date.toUTCString()
    }
    return match
  }

  if (line.length <= maxLineLength) {
    return line.replace(/\d+/g, replaceEpochTimes)
  }
  return line
}
