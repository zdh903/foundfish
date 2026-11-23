import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';

import { AsyncThunkConfig } from '@/store';
import { sortFundsAction } from '@/store/features/fund';
import { sortZindexsAction } from '@/store/features/zindex';
import { sortQuotationsAction } from '@/store/features/quotation';
import * as Enums from '@/utils/enums';
import * as Helpers from '@/helpers';

type SortMode = {
  fundSortMode: Helpers.Sort.FundSortMode;
  zindexSortMode: Helpers.Sort.ZindexSortMode;
  quotationSortMode: Helpers.Sort.QuotationSortType;
};

type ViewMode = {
  fundViewMode: {
    type: Enums.FundViewType;
  };
  zindexViewMode: {
    type: Enums.ZindexViewType;
  };
  quotationViewMode: {
    type: Enums.QuotationViewType;
  };
};

export type SortState = {
  sortMode: SortMode;
  viewMode: ViewMode;
};

export const initialState: SortState = {
  sortMode: {
    fundSortMode: {
      type: Enums.FundSortType.Custom,
      order: Enums.SortOrderType.Desc,
    },
    zindexSortMode: {
      type: Enums.ZindexSortType.Custom,
      order: Enums.SortOrderType.Desc,
    },
    quotationSortMode: {
      type: Enums.QuotationSortType.Zdf,
      order: Enums.SortOrderType.Desc,
    },
  },
  viewMode: {
    fundViewMode: {
      type: Enums.FundViewType.List,
    },
    zindexViewMode: {
      type: Enums.ZindexViewType.Grid,
    },
    quotationViewMode: {
      type: Enums.QuotationViewType.Flow,
    },
  },
};

const sortSlice = createSlice({
  name: 'sort',
  initialState,
  reducers: {
    syncSortModeAction(state, action: PayloadAction<SortMode>) {
      state.sortMode = action.payload;
    },
    syncViewModeAction(state, action: PayloadAction<ViewMode>) {
      state.viewMode = action.payload;
    },
  },
});

export const { syncSortModeAction, syncViewModeAction } = sortSlice.actions;

export const setSortModeAction = createAsyncThunk<void, SortMode, AsyncThunkConfig>(
  'sort/setSortModeAction',
  (newSortMode, { dispatch, getState }) => {
    try {
      const {
        sort: { sortMode },
      } = getState();
      dispatch(syncSortModeAction({ ...sortMode, ...newSortMode }));
    } catch (error) {}
  }
);

export const setViewModeAction = createAsyncThunk<void, ViewMode, AsyncThunkConfig>(
  'sort/setViewModeAction',
  (newViewMode, { dispatch, getState }) => {
    try {
      const {
        sort: { viewMode },
      } = getState();
      dispatch(syncViewModeAction({ ...viewMode, ...newViewMode }));
    } catch (error) {}
  }
);

export const setFundSortModeAction = createAsyncThunk<
  void,
  { type?: Enums.FundSortType; order?: Enums.SortOrderType },
  AsyncThunkConfig
>('sort/setFundSortModeAction', (mode, { dispatch, getState }) => {
  try {
    const {
      sort: { sortMode },
      wallet: { currentWalletCode },
    } = getState();

    const fundSortMode = { ...sortMode.fundSortMode, ...mode };

    dispatch(setSortModeAction({ ...sortMode, fundSortMode }));
    dispatch(sortFundsAction(currentWalletCode));
  } catch (error) {}
});

export const troggleFundSortOrderAction = createAsyncThunk<void, void, AsyncThunkConfig>(
  'sort/troggleFundSortOrderAction',
  (_, { dispatch, getState }) => {
    try {
      const {
        sort: { sortMode },
        wallet: { currentWalletCode },
      } = getState();

      const fundSortMode = {
        ...sortMode.fundSortMode,
        order:
          sortMode.fundSortMode.order === Enums.SortOrderType.Asc ? Enums.SortOrderType.Desc : Enums.SortOrderType.Asc,
      };

      dispatch(setSortModeAction({ ...sortMode, fundSortMode }));
      dispatch(sortFundsAction(currentWalletCode));
    } catch (error) {}
  }
);

export const setZindexSortModeAction = createAsyncThunk<
  void,
  { type?: Enums.ZindexSortType; order?: Enums.SortOrderType },
  AsyncThunkConfig
>('sort/setZindexSortModeAction', (mode, { dispatch, getState }) => {
  try {
    const {
      sort: { sortMode },
    } = getState();

    const zindexSortMode = { ...sortMode.zindexSortMode, ...mode };

    dispatch(setSortModeAction({ ...sortMode, zindexSortMode }));
    dispatch(sortZindexsAction());
  } catch (error) {}
});

export const troggleZindexSortOrderAction = createAsyncThunk<void, void, AsyncThunkConfig>(
  'sort/troggleZindexSortOrderAction',
  (_, { dispatch, getState }) => {
    try {
      const {
        sort: { sortMode },
      } = getState();

      const zindexSortMode = {
        ...sortMode.zindexSortMode,
        order:
          sortMode.zindexSortMode.order === Enums.SortOrderType.Asc
            ? Enums.SortOrderType.Desc
            : Enums.SortOrderType.Asc,
      };
      dispatch(setSortModeAction({ ...sortMode, zindexSortMode }));
      dispatch(sortZindexsAction());
    } catch (error) {}
  }
);

export const setQuotationSortModeAction = createAsyncThunk<
  void,
  { type?: Enums.QuotationSortType; order?: Enums.SortOrderType },
  AsyncThunkConfig
>('sort/setQuotationSortModeAction', (mode, { dispatch, getState }) => {
  try {
    const {
      sort: { sortMode },
    } = getState();

    const quotationSortMode = { ...sortMode.quotationSortMode, ...mode };
    dispatch(setSortModeAction({ ...sortMode, quotationSortMode }));
    dispatch(sortQuotationsAction());
  } catch (error) {}
});

export const troggleQuotationSortOrderAction = createAsyncThunk<void, void, AsyncThunkConfig>(
  'sort/troggleQuotationSortOrderAction',
  (_, { dispatch, getState }) => {
    try {
      const {
        sort: { sortMode },
      } = getState();

      const quotationSortMode = {
        ...sortMode.quotationSortMode,
        order:
          sortMode.quotationSortMode.order === Enums.SortOrderType.Asc
            ? Enums.SortOrderType.Desc
            : Enums.SortOrderType.Asc,
      };

      dispatch(setSortModeAction({ ...sortMode, quotationSortMode }));
      dispatch(sortQuotationsAction());
    } catch (error) {}
  }
);

export const setFundViewModeAction = createAsyncThunk<void, { type: Enums.FundViewType }, AsyncThunkConfig>(
  'sort/setFundViewModeAction',
  (mode, { dispatch, getState }) => {
    try {
      const {
        sort: { viewMode },
      } = getState();

      const fundViewMode = { ...viewMode.fundViewMode, ...mode };
      dispatch(setViewModeAction({ ...viewMode, fundViewMode }));
    } catch (error) {}
  }
);

export const setZindexViewModeAction = createAsyncThunk<void, { type: Enums.ZindexViewType }, AsyncThunkConfig>(
  'sort/setZindexViewModeAction',
  (mode, { dispatch, getState }) => {
    try {
      const {
        sort: { viewMode },
      } = getState();

      const zindexViewMode = { ...viewMode.zindexViewMode, ...mode };

      dispatch(setViewModeAction({ ...viewMode, zindexViewMode }));
    } catch (error) {}
  }
);

export const setQuotationViewModeAction = createAsyncThunk<void, { type: Enums.QuotationViewType }, AsyncThunkConfig>(
  'sort/setQuotationViewModeAction',
  (mode, { dispatch, getState }) => {
    try {
      const {
        sort: { viewMode },
      } = getState();

      const quotationViewMode = { ...viewMode.quotationViewMode, ...mode };
      dispatch(setViewModeAction({ ...viewMode, quotationViewMode }));
    } catch (error) {}
  }
);

export default sortSlice.reducer;
