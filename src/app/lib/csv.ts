import Papa from 'papaparse'

export const CSV_MAX_BYTES = 2 * 1024 * 1024
export const CSV_MAX_ROWS = 5000
export const PARSER_VERSION = 'brie-csv-1'

export type CsvParseError =
  | { code: 'TOO_LARGE'; message: string }
  | { code: 'TOO_MANY_ROWS'; message: string }
  | { code: 'MALFORMED'; message: string }
  | { code: 'EMPTY'; message: string }
  | { code: 'ENCODING'; message: string }

export type ParsedCsv = {
  headers: string[]
  headerLabels: string[]
  rows: Array<{ rowNumber: number; values: string[] }>
  blankRowCount: number
}

function isBlank(values: string[]): boolean {
  return values.every((value) => value.trim() === '')
}

function labelHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((header, index) => {
    const raw = header.trim() === '' ? `Column ${index + 1}` : header.trim()
    const count = (seen.get(raw.toLowerCase()) ?? 0) + 1
    seen.set(raw.toLowerCase(), count)
    return count === 1 ? raw : `${raw} (${count})`
  })
}

export function parseAttendanceCsv(text: string): ParsedCsv | { error: CsvParseError } {
  if (text.includes('\uFFFD')) {
    return {
      error: {
        code: 'ENCODING',
        message: 'This file is not valid UTF-8. Save it as a UTF-8 CSV and try again.',
      },
    }
  }

  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: false,
    delimiter: ',',
  })

  if (result.errors.some((error) => error.type === 'Quotes' || error.code === 'UndetectableDelimiter')) {
    return {
      error: {
        code: 'MALFORMED',
        message: 'This CSV has malformed quoting. Check quotation marks and try again.',
      },
    }
  }

  const records = result.data
    .map((values) => values.map((value) => (value ?? '').replace(/^\uFEFF/, '')))
    .filter((values, index, all) => !(index === all.length - 1 && isBlank(values)))
  if (records.length === 0) {
    return { error: { code: 'EMPTY', message: 'This file has no attendance rows. Choose another file.' } }
  }

  const headers = records[0] ?? []
  const headerLabels = labelHeaders(headers)
  const rows: ParsedCsv['rows'] = []
  let blankRowCount = 0

  for (let index = 1; index < records.length; index += 1) {
    const values = records[index] ?? []
    if (isBlank(values)) {
      blankRowCount += 1
      continue
    }
    rows.push({ rowNumber: index + 1, values })
  }

  if (rows.length === 0) {
    return { error: { code: 'EMPTY', message: 'This file has no attendance rows. Choose another file.' } }
  }
  if (rows.length > CSV_MAX_ROWS) {
    return {
      error: {
        code: 'TOO_MANY_ROWS',
        message: `This file has more than ${CSV_MAX_ROWS.toLocaleString()} data rows. Split it and import again.`,
      },
    }
  }

  return { headers, headerLabels, rows, blankRowCount }
}

export function guessEmailColumn(labels: string[]): number | null {
  const exact = labels.findIndex((label) => label.trim().toLowerCase() === 'email')
  return exact >= 0 ? exact : null
}

export function guessNameColumn(labels: string[]): number | null {
  const exact = labels.findIndex((label) => label.trim().toLowerCase() === 'name')
  return exact >= 0 ? exact : null
}

export function exampleCsv(): string {
  return 'name,email\nAlex Rivera,alex.rivera@example.edu\nJordan Lee,jordan.lee@example.edu\n'
}
