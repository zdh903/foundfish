import { isAnyOf } from '@reduxjs/toolkit';
import { ShareAction } from '@/store';
import listenerMiddleware from '@/store/listeners';
import { syncFavoriteQuotationMapAction } from '@/store/features/quotation';
import { saveSyncConfigAction } from '@/store/features/setting';
import { changeCurrentWalletCodeAction, syncWalletsConfigAction } from '@/store/features/wallet';
import { syncWebConfigAction } from '@/store/features/web';
import { syncZindexesConfigAction } from '@/store/features/zindex';
import { syncTranslateSettingAction } from '@/store/features/translate';

const syncistener = () => {
  listenerMiddleware.startListening({
    matcher: isAnyOf(
      syncZindexesConfigAction,
      syncWebConfigAction,
      syncWalletsConfigAction,
      syncFavoriteQuotationMapAction,
      changeCurrentWalletCodeAction,
      syncTranslateSettingAction
    ),
    effect: (action: ShareAction, { dispatch, getState }) => {
      if (!action._share) {
        const {
          setting: {
            systemSetting: { syncConfigSetting, syncConfigPathSetting },
          },
        } = getState();
        if (syncConfigSetting && syncConfigPathSetting) {
          dispatch(saveSyncConfigAction());
        }
      }
    },
  });
};
export default syncistener;
