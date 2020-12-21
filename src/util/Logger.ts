import { grey, green, yellow, red, blue } from "chalk";

class Logger {
    public log(source: string, message: string) {
        console.log(`${source} |`, grey(message));
    }

    public info(source: string, message: string) {
        console.log(`${source} |`, green(message));
    }

    public warn(source: string, message: string) {
        console.log(`${source} |`, yellow(message));
    }

    public error(source: string, message: string) {
        console.log(`${source} |`, red(message));
    }

    public debug(source: string, message: string) {
        console.log(`${source} |`, blue(message));
    }
}

export default new Logger();