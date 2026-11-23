declare module 'hxc3-indicator-formula' {
  export interface IndicatorResult {
    [key: string]: any;
  }
  export function indicatorFormula(options: any): IndicatorResult;
  export const IndicatorFormula: {
    getClass(name: string): any;
  };
  const _default: { indicatorFormula: typeof indicatorFormula };
  export default _default;
}
