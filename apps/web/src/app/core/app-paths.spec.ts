import type { Route } from '@angular/router';
import { routes } from '../app.routes';
import { CONSOLE_ROUTES } from '../features/console/console.routes';
import { PATHS } from './app-paths';

/** Every full path the route tables define, with `:params`. */
const patterns = (list: Route[], prefix = ''): string[] =>
  list.flatMap((r) => {
    const path = [prefix, r.path].filter(Boolean).join('/');
    const own =
      r.path !== undefined && r.path !== '**' && (r.component || r.loadComponent) ? [path] : [];
    const children = r.path === 'console' ? CONSOLE_ROUTES : (r.children ?? []);
    return [...own, ...patterns(children, path)];
  });

const matches = (url: string, pattern: string) =>
  new RegExp(`^/${pattern.replace(/:[^/]+/g, '[^/]+')}$`).test(url);

/** Every path PATHS can produce (builders get a sample id). */
const urls = (node: object): string[] =>
  Object.values(node).flatMap((v) =>
    typeof v === 'string'
      ? [v]
      : typeof v === 'function'
        ? ['/' + (v('id-1') as string[]).join('/').replace(/^\/+/, '')]
        : urls(v as object),
  );

describe('PATHS', () => {
  it('every path leads to a page the router knows', () => {
    const known = patterns(routes);
    for (const url of urls(PATHS)) {
      expect(known.some((p) => matches(url, p)) || (url === '/' && known.includes('')), url).toBe(
        true,
      );
    }
  });
});
