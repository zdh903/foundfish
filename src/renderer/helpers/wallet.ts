import NP from 'number-precision';
import { defaultWallet } from '@/store/features/wallet';
import * as Helpers from '@/helpers';

export const walletIcons = new Array(12)
  .fill('')
  .map((_, index) => new URL(`../static/wallet/${index}.png`, import.meta.url).href);

export function GetCurrentWalletState(walletCode: string, wallets: Wallet.StateItem[]) {
  return (
    wallets.find(({ code }) => code === walletCode) || {
      code: walletCode,
      funds: [],
      updateTime: '',
    }
  );
}

export function GetCurrentWalletConfig(walletCode: string, walletsConfig: Wallet.SettingItem[]) {
  return walletsConfig.find(({ code }) => code === walletCode) || defaultWallet;
}

export function CalcWallet(option: { wallets: Wallet.StateItem[]; walletConfig: Wallet.SettingItem[]; code: string }) {
  const { wallets, walletConfig, code } = option;
  const { funds } = Helpers.Wallet.GetCurrentWalletState(code, wallets);
  const { codeMap: fundConfigCodeMap } = Helpers.Fund.GetFundConfig(code, walletConfig);
  const calcFundResult = Helpers.Fund.CalcFunds(funds, fundConfigCodeMap);
  const zje = calcFundResult.zje || 0;
  const sygz = calcFundResult.sygz || 0;
  const gszje = calcFundResult.gszje || 0;
  const gssyl = zje ? NP.times(NP.divide(sygz, zje), 100) : 0;
  const cysy = calcFundResult.cysy || 0;
  const cysyl = zje ? NP.times(NP.divide(cysy, zje - cysy), 100) : 0;

  return {
    zje, // 总金额
    sygz, // 收益估值
    gszje, // 估算总金额
    gssyl, // 估算收益率
    cysy, // 持有收益
    cysyl, // 持有收益率
    calcFundResult,
  };
}
