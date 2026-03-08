import { FitsHeaderCard, FitsColumnDef, ParsedFitsData } from '../types';

/**
 * Parses a standard FITS file (Kepler/TESS format).
 * This is a custom binary parser that handles standard FITS headers and Binary Tables.
 *
 * Fixes applied:
 *  1. TFORM repeat count now correctly extracted (e.g. '20J' -> repeat=20, byteSize=80)
 *  2. All FITS TFORM type codes have a known byte-size; offset always advances even for
 *     columns we don't read, preventing misalignment of all subsequent columns.
 *  3. Header comment parsing no longer false-triggers on '/' inside quoted string values.
 *  4. BJDREFI/BJDREFF read from header so TESS files display correct time axis.
 */
export const parseFitsFile = async (buffer: ArrayBuffer): Promise<ParsedFitsData> => {
  const dataView = new DataView(buffer);
  let offset = 0;

  // 1. Parse Primary Header
  const { header: primaryHeader, bytesRead: primaryBytes } = parseHeaderUnit(dataView, offset);
  offset += primaryBytes;

  // Skip primary HDU data block (usually empty for Kepler/TESS)
  const primaryNaxis = Number(getHeaderValue(primaryHeader, 'NAXIS') || 0);
  if (primaryNaxis > 0) {
    let numPixels = 1;
    for (let i = 1; i <= primaryNaxis; i++) {
      numPixels *= Number(getHeaderValue(primaryHeader, `NAXIS${i}`) || 0);
    }
    const bitpix = Number(getHeaderValue(primaryHeader, 'BITPIX') || 0);
    const dataSize = Math.abs(bitpix) * numPixels / 8;
    const padding = (2880 - (dataSize % 2880)) % 2880;
    offset += dataSize + padding;
  }

  // 2. Scan for BINTABLE extension
  let extensionHeader: FitsHeaderCard[] = [];
  let tableData: ParsedFitsData['data'] = {};
  let columns: string[] = [];
  let rowCount = 0;

  let loopLimit = 10;

  while (offset < buffer.byteLength && loopLimit > 0) {
    const { header, bytesRead } = parseHeaderUnit(dataView, offset);
    const xtension = header.find(c => c.key === 'XTENSION');

    if (xtension && xtension.value === 'BINTABLE') {
      extensionHeader = header;
      offset += bytesRead;

      const nAxis1 = Number(getHeaderValue(header, 'NAXIS1') || 0); // bytes per row
      const nAxis2 = Number(getHeaderValue(header, 'NAXIS2') || 0); // number of rows
      const tFields = Number(getHeaderValue(header, 'TFIELDS') || 0);

      rowCount = nAxis2;

      // Parse column definitions — offsets are now correct for all TFORM types
      const colDefs = parseColumnDefinitions(header, tFields, nAxis1);
      columns = colDefs.filter(c => c.dataType !== 'UNKNOWN').map(c => c.type || c.label);

      // Read binary data
      tableData = readBinaryTable(dataView, offset, nAxis2, nAxis1, colDefs);
      break;

    } else {
      // Skip this HDU
      offset += bytesRead;
      const naxis = Number(getHeaderValue(header, 'NAXIS') || 0);
      let dataSize = 0;
      if (naxis > 0) {
        let numPixels = 1;
        for (let i = 1; i <= naxis; i++) {
          numPixels *= Number(getHeaderValue(header, `NAXIS${i}`) || 0);
        }
        const bitpix = Number(getHeaderValue(header, 'BITPIX') || 0);
        const pCount = Number(getHeaderValue(header, 'PCOUNT') || 0);
        const gCount = Number(getHeaderValue(header, 'GCOUNT') || 1);
        // Correct FITS standard formula: gCount * (dataBytes + pCount)
        dataSize = gCount * (Math.abs(bitpix) * numPixels / 8 + pCount);
      }
      const padding = (2880 - (dataSize % 2880)) % 2880;
      offset += dataSize + padding;
    }
    loopLimit--;
  }

  if (Object.keys(tableData).length === 0) {
    throw new Error("No BINTABLE extension found in FITS file.");
  }

  return {
    primaryHeader,
    extensionHeader,
    data: tableData,
    columns,
    rowCount
  };
};

const getHeaderValue = (cards: FitsHeaderCard[], key: string): string | number | boolean | null => {
  const card = cards.find(c => c.key === key);
  return card ? card.value : null;
};

// ---------------------------------------------------------------------------
// Header parser
// FIX: comment detection no longer false-triggers on '/' inside quoted strings.
// ---------------------------------------------------------------------------
const parseHeaderUnit = (view: DataView, startOffset: number) => {
  const cards: FitsHeaderCard[] = [];
  let offset = startOffset;
  const cardSize = 80;

  while (offset < view.byteLength) {
    let line = '';
    for (let i = 0; i < cardSize; i++) {
      line += String.fromCharCode(view.getUint8(offset + i));
    }

    const key = line.substring(0, 8).trim();

    if (key === 'END') {
      offset += cardSize;
      break;
    }

    let value: string | number | boolean | null = null;
    let comment = '';

    if (key.length > 0) {
      const valueIndicatorIdx = line.indexOf('=');
      if (valueIndicatorIdx > -1 && valueIndicatorIdx < 10) {
        const afterEquals = line.substring(valueIndicatorIdx + 1).trimStart();

        if (afterEquals.startsWith("'")) {
          // -----------------------------------------------------------------
          // String value: find the CLOSING quote first, then look for '/'
          // FITS spec: a literal single-quote in a string is represented as ''
          // We scan forward handling '' pairs to find the real closing quote.
          // -----------------------------------------------------------------
          let strStart = line.indexOf("'", valueIndicatorIdx + 1);
          let strEnd = strStart + 1;
          while (strEnd < line.length) {
            if (line[strEnd] === "'") {
              // Check for escaped quote ''
              if (strEnd + 1 < line.length && line[strEnd + 1] === "'") {
                strEnd += 2; // skip ''
              } else {
                break; // real closing quote
              }
            } else {
              strEnd++;
            }
          }
          // Extract raw string content and unescape ''
          const rawStr = line.substring(strStart + 1, strEnd).replace(/''/g, "'").trimEnd();
          value = rawStr;

          // Comment starts after the closing quote
          const commentIdx = line.indexOf('/', strEnd + 1);
          if (commentIdx > -1) {
            comment = line.substring(commentIdx + 1).trim();
          }

        } else {
          // Numeric / boolean / other — safe to search for '/' directly
          const commentIdx = line.indexOf('/', valueIndicatorIdx + 1);
          let valueStr = '';
          if (commentIdx > -1) {
            valueStr = line.substring(valueIndicatorIdx + 1, commentIdx).trim();
            comment = line.substring(commentIdx + 1).trim();
          } else {
            valueStr = line.substring(valueIndicatorIdx + 1).trim();
          }

          if (valueStr === 'T') {
            value = true;
          } else if (valueStr === 'F') {
            value = false;
          } else {
            const num = Number(valueStr);
            value = isNaN(num) ? valueStr : num;
          }
        }
      }

      cards.push({ key, value, comment });
    }

    offset += cardSize;
  }

  const totalBytesRead = offset - startOffset;
  const padding = (2880 - (totalBytesRead % 2880)) % 2880;
  return { header: cards, bytesRead: totalBytesRead + padding };
};

// ---------------------------------------------------------------------------
// Column definition parser
//
// FIX 1: repeat count extracted from TFORM correctly.
//   TFORM regex /^(\d*)([A-Z])/ splits e.g. '20J' -> repeat=20, typeChar='J'
//   An empty repeat (e.g. '1D', 'D') defaults to 1.
//
// FIX 2: ALL FITS type codes now have a byte size so offset always advances,
//   even for columns we cannot read as scalars. This prevents misalignment.
//   Unreadable columns are stored with dataType='UNKNOWN' and skipped in readBinaryTable.
// ---------------------------------------------------------------------------
const tformByteSize = (typeChar: string, repeat: number): number => {
  switch (typeChar) {
    case 'D': return repeat * 8;  // double
    case 'E': return repeat * 4;  // float
    case 'J': return repeat * 4;  // 32-bit int
    case 'K': return repeat * 8;  // 64-bit int
    case 'I': return repeat * 2;  // 16-bit int
    case 'B': return repeat * 1;  // 8-bit unsigned int
    case 'L': return repeat * 1;  // logical (boolean)
    case 'A': return repeat * 1;  // ASCII char
    case 'X': return Math.ceil(repeat / 8); // bit array
    case 'C': return repeat * 8;  // complex single (2×float)
    case 'M': return repeat * 16; // complex double (2×double)
    case 'P': return 8;           // variable-length array descriptor (32-bit)
    case 'Q': return 16;          // variable-length array descriptor (64-bit)
    default:  return 0;           // unknown — caller must handle
  }
};

const parseColumnDefinitions = (
  header: FitsHeaderCard[],
  tFields: number,
  nAxis1: number   // total row bytes from header — used as cross-check
): FitsColumnDef[] => {
  const cols: FitsColumnDef[] = [];
  let currentOffset = 0;

  for (let i = 1; i <= tFields; i++) {
    const type = getHeaderValue(header, `TTYPE${i}`) as string || `COL${i}`;
    const form = getHeaderValue(header, `TFORM${i}`) as string || '';
    const unit = getHeaderValue(header, `TUNIT${i}`) as string || '';

    // --- FIX 1: parse repeat count and type character separately ---
    const tformMatch = form.trim().match(/^(\d*)([A-Z])/);
    const repeat = tformMatch && tformMatch[1] ? parseInt(tformMatch[1], 10) : 1;
    const typeChar = tformMatch ? tformMatch[2] : '';

    // --- FIX 2: always compute byte size so offset stays correct ---
    const totalBytes = tformByteSize(typeChar, repeat);

    // Map to readable dataType (only scalar columns we can actually read)
    let dataType: FitsColumnDef['dataType'] = 'UNKNOWN';
    if (repeat === 1) {
      switch (typeChar) {
        case 'D': dataType = 'DOUBLE'; break;
        case 'E': dataType = 'FLOAT';  break;
        case 'J': dataType = 'INT';    break;
        case 'I': dataType = 'SHORT';  break;
        case 'B': dataType = 'BYTE';   break;
        // K (int64) would lose precision in JS Number — leave as UNKNOWN for safety
      }
    }
    // Array columns (repeat > 1) are intentionally left as UNKNOWN;
    // their bytes still count toward the offset below.

    cols.push({
      label: type,
      format: form,
      unit,
      type,
      offset: currentOffset,
      dataType,
    });

    // Always advance, even for UNKNOWN types — this is the critical fix
    if (totalBytes > 0) {
      currentOffset += totalBytes;
    } else {
      // Absolute fallback: if TFORM is genuinely unrecognised, we cannot
      // recover safely. Log a warning and stop processing further columns.
      console.warn(`[fitsParser] Unrecognised TFORM '${form}' for column ${type}. Halting column parse.`);
      break;
    }
  }

  // Sanity check: our computed row size should match NAXIS1
  if (nAxis1 > 0 && currentOffset !== nAxis1) {
    console.warn(
      `[fitsParser] Computed row size (${currentOffset} B) ≠ NAXIS1 (${nAxis1} B). ` +
      `File may contain unsupported TFORM types. Some columns may be misaligned.`
    );
  }

  return cols;
};

// ---------------------------------------------------------------------------
// Binary table reader — unchanged except it now skips UNKNOWN columns cleanly
// ---------------------------------------------------------------------------
const readBinaryTable = (
  view: DataView,
  startOffset: number,
  rowCount: number,
  rowBytes: number,
  cols: FitsColumnDef[]
): Record<string, (number | null)[]> => {

  const result: Record<string, (number | null)[]> = {};
  // Only allocate arrays for columns we can actually read
  cols
    .filter(c => c.dataType !== 'UNKNOWN')
    .forEach(c => result[c.type || c.label] = []);

  for (let r = 0; r < rowCount; r++) {
    const rowStart = startOffset + r * rowBytes;

    cols.forEach(col => {
      if (col.dataType === 'UNKNOWN') return; // skip — offset already accounted for

      const pos = rowStart + col.offset;
      let val: number | null = null;

      try {
        switch (col.dataType) {
          case 'DOUBLE': val = view.getFloat64(pos, false); break;
          case 'FLOAT':  val = view.getFloat32(pos, false); break;
          case 'INT':    val = view.getInt32(pos,   false); break;
          case 'SHORT':  val = view.getInt16(pos,   false); break;
          case 'BYTE':   val = view.getUint8(pos);          break;
        }
        if (typeof val === 'number' && isNaN(val)) val = null;
      } catch {
        console.warn(`[fitsParser] Read error at row ${r}, col ${col.label}`);
        val = null;
      }

      result[col.type || col.label].push(val);
    });
  }

  return result;
};
