export interface ILogger {
  /**
   * Logs informatative data.
   * @param message The data to log
   */
  info(...message: any): void;

  /**
   * Logs warning data.
   * @param message The data to log
   */
  warn(...message: any): void;

  /**
   * Logs erroring data.
   * @param message The data to log
   */
  error(...message: any): void;

  /**
   * Logs debugging data.
   * @param message The data to log
   */
  debug(...message: any): void;

  /**
   * Logs verbose data.
   * @param message The data to log
   */
  verbose(...message: any): void;
}

export class Logger implements ILogger {
  public info(...message: any) {
    console.log(...message);
  }

  public warn(...message: any) {
    console.warn(...message);
  }

  public error(...message: any) {
    console.error(...message);
  }

  public debug(...message: any) {
    console.debug(...message);
  }

  public verbose(...message: any) {
    console.log(...message);
  }
}
