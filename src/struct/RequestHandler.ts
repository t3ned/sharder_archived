import { randomBytes } from "crypto";
import { IPC } from "./IPC";
import { RequestMethod, MessageFile, RequestHandler, Client } from "eris";

export class SyncedRequestHandler extends RequestHandler {
    public ipc: IPC;
    public timeout: number;

    public constructor(client: Client, ipc: IPC, options: RequestHandlerOptions) {
        super(client);
        this.ipc = ipc;
        this.timeout = options.timeout;
    }

    public request(
        method: RequestMethod,
        url: string,
        auth?: boolean,
        body?: RequestBody,
        file?: MessageFile,
        route?: string,
        short?: boolean
    ): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject) => {
            const stackCapture = new Error().stack!;
            const requestID = randomBytes(16).toString();

            if (file && typeof file.file === "string")
                file.file = Buffer.from(file.file).toString("base64");

            process.send!({
                name: "apiRequest", requestID,
                method, url, auth, body, file,
                route, short
            });

            const timeout = setTimeout(() => {
                reject(new Error(`Request timed out (>${this.timeout}ms) on ${method} ${url}`));
                this.ipc.unregister(`apiRequest.${requestID}`);
            }, this.timeout);

            this.ipc.register(`apiRequest.${requestID}`, (data) => {
                if (data.error) {
                    const error = new Error(data.error.message);
                    error.stack = data.error.stack + "\n" + stackCapture.substring(stackCapture.indexOf("\n") + 1);
                    // error.code = data.error.code;
                    console.log(error.stack);
                    reject(error);
                } else {
                    resolve(data.data);
                }

                clearTimeout(timeout);
                this.ipc.unregister(`apiRequest.${requestID}`);
            });
        });
    }
}

export interface RequestHandlerOptions {
    timeout: number;
}

export interface RequestBody {
    [k: string]: unknown;
}