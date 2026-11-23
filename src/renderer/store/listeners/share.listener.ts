import { isAnyOf } from '@reduxjs/toolkit';
import { ShareAction } from '@/store';
import listenerMiddleware from '@/store/listeners';
import { syncFundRatingMapAction, syncRemoteFundsMapAction } from '@/store/features/fund';
import { syncFavoriteQuotationMapAction } from '@/store/features/quotation';
import { syncSettingAction } from '@/store/features/setting';
import { changeCurrentWalletCodeAction, syncWalletsConfigAction } from '@/store/features/wallet';
import { syncWebConfigAction } from '@/store/features/web';
import { syncZindexesConfigAction } from '@/store/features/zindex';

const { ipcRenderer } = window.contextModules.electron;

const shareListener = () => {
  listenerMiddleware.startListening({
    matcher: isAnyOf(
      syncZindexesConfigAction,
      syncWebConfigAction,
      syncWalletsConfigAction,
      syncFundRatingMapAction,
      syncSettingAction,
      syncFavoriteQuotationMapAction,
      changeCurrentWalletCodeAction,
      syncRemoteFundsMapAction
    ),
    effect: (action: ShareAction, listenerApi) => {
      if (!action._share) {
        ipcRenderer.invoke('sync-multi-window-store', action);
      }
    },
  });
};
export default shareListener;
