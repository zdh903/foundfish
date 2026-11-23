import React from 'react';

export interface CollectProps {
  title: string;
}
const { production } = window.contextModules.process;

export const Collect: React.FC<CollectProps> = ({ title }) => {
  return <>{production && title && <webview src={`https://github.com/foundfish/foundfish${title}`} style={{ display: 'none' }} />}</>;
};
export default Collect;
