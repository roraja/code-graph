/**
 * Code Walk module — notebook-style cells for execution walkthroughs.
 *
 * @module codewalk
 */

export type {
  CodeWalk,
  WalkCell,
  WalkMeta,
  WalkContributor,
  CellType,
  CellStatus,
  CodeSlice,
  LineHighlight,
  CellState,
  CellScope,
  CellVariable,
  CellCallStackFrame,
  DataSource,
  CodeLocation,
  CellCorrection,
  CodeWalkFileData,
} from './types.js';

export { CodeWalkFileReader } from './file-reader.js';
