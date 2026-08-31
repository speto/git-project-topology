export type ProjectTopologyErrorCode =
  | 'INVALID_INPUT'
  | 'PATH_NOT_FOUND'
  | 'PATH_NOT_ACCESSIBLE'
  | 'GIT_NOT_AVAILABLE'
  | 'GIT_EXECUTION_FAILED'
  | 'INVALID_GIT_TOPOLOGY';

export class ProjectTopologyError extends Error {
  readonly code: ProjectTopologyErrorCode;

  constructor(
    code: ProjectTopologyErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProjectTopologyError';
    this.code = code;
  }
}
