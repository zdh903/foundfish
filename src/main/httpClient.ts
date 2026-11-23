import { Agent, request, Dispatcher, interceptors, cacheStores, buildConnector } from 'undici';
import { Resolver } from 'node:dns';
import { lookup as systemLookup } from 'node:dns';
import enhInterceptors from '@lib/enh/httpInterceptors';

export type RequestConfig = {
  responseType?: 'json' | 'text' | 'arraybuffer';
  headers?: Record<string, string>;
  searchParams?: Record<string, any>;
  method?: Dispatcher.RequestOptions['method'];
  body?: Dispatcher.RequestOptions['body'];
};
export type HttpResponse<T> = {
  body: T;
  headers: Dispatcher.RequestOptions['headers'];
};

// 公共 DNS 服务器，绕过 VPN fake DNS (198.18.0.1)
// 223.5.5.5 的 UDP 53 被某些 VPN 拦截，119.29.29.29 通常可用
const publicResolver = new Resolver();
publicResolver.setServers(['119.29.29.29', '223.5.5.5']);

// 用公共 DNS 解析域名为 IP 地址
function resolveHost(hostname: string): Promise<string | null> {
  return new Promise((resolve) => {
    publicResolver.resolve4(hostname, (err4, addrs4) => {
      if (!err4 && addrs4 && addrs4.length) {
        resolve(addrs4[0]);
      } else {
        publicResolver.resolve6(hostname, (err6, addrs6) => {
          if (!err6 && addrs6 && addrs6.length) {
            resolve(addrs6[0]);
          } else {
            resolve(null);
          }
        });
      }
    });
  });
}

// 自定义 connector：先用公共 DNS 解析域名，再用 IP 直连
// 这样可以绕过 VPN 的 fake DNS，同时保持 TLS SNI/证书验证
const baseConnector = buildConnector({ timeout: 8000 });
const customConnector = (opts: any, cb: any) => {
  const hostname = opts.hostname;
  if (!hostname || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname === 'localhost' || hostname === '127.0.0.1') {
    // 已经是 IP 或 localhost，直接连接
    baseConnector(opts, cb);
    return;
  }
  resolveHost(hostname).then((ip) => {
    if (ip) {
      // 用解析到的 IP 连接，servername 保持域名做 SNI + 证书验证
      baseConnector({ ...opts, host: ip, servername: hostname }, cb);
    } else {
      // 公共 DNS 失败，回退到系统 DNS
      baseConnector(opts, cb);
    }
  }).catch(() => {
    baseConnector(opts, cb);
  });
};

export default class HttpClient {
  private static agent = new Agent({
    connect: customConnector as any,
  });
  public userAgent?: string;
  public dispatcher?: Dispatcher;

  public async request(url: string, config?: Omit<RequestConfig, 'responseType'>): Promise<HttpResponse<string>>;
  public async request(url: string, config?: RequestConfig & { responseType: 'text' }): Promise<HttpResponse<string>>;
  public async request(url: string, config?: RequestConfig & { responseType: 'arraybuffer' }): Promise<HttpResponse<ArrayBuffer>>;
  public async request<Res = unknown>(url: string, config?: RequestConfig & { responseType: 'json' }): Promise<HttpResponse<Res>>;
  public async request(url: string, config?: RequestConfig) {
    try {
      const headers = {
        'User-Agent': this.userAgent,
        'Host': new URL(url).host,
        ...config?.headers,
      } as Record<string, string>;

      const dispatcher = this.dispatcher || HttpClient.agent;

      const res = await request(url, {
        headers,
        body: config?.body,
        method: config?.method,
        query: config?.searchParams,
        dispatcher: dispatcher.compose(
          interceptors.cache({
            store: new cacheStores.MemoryCacheStore({
              maxSize: 50 * 1024 * 1024,
              maxCount: 1000,
              maxEntrySize: 2 * 1024 * 1024,
            }),
            methods: ['GET'],
          }),
          ...enhInterceptors
        ),
      });
      if (config?.responseType === 'json') {
        return {
          body: await res.body.json(),
          headers: res.headers,
        };
      } else if (config?.responseType === 'arraybuffer') {
        return {
          body: await res.body.arrayBuffer(),
          headers: res.headers,
        };
      } else {
        return {
          body: await res.body.text(),
          headers: res.headers,
        };
      }
    } catch (e) {
      try {
        console.error('[HttpClient] request failed:', url, (e as Error)?.message);
      } catch {
        // stderr 管道已关闭（打包 menubar app 无终端），忽略 EPIPE
      }
      return {} as any;
    }
  }
}
