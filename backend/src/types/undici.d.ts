declare module "undici" {
  export class Agent {
    constructor(options?: {
      connections?: number;
      pipelining?: number;
      keepAliveTimeout?: number;
      keepAliveMaxTimeout?: number;
    });
    close(): Promise<void>;
  }

  export function request(
    url: string,
    options?: {
      method?: string;
      dispatcher?: Agent;
      headersTimeout?: number;
      bodyTimeout?: number;
    }
  ): Promise<{
    statusCode: number;
    body: { dump(): Promise<void> };
  }>;
}
