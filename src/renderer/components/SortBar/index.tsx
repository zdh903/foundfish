import React, { useState } from 'react';
import { useScroll, useDebounceFn, useBoolean } from 'ahooks';
import clsx from 'clsx';
import { Dropdown, Menu } from 'antd';
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiArrowDownSFill,
  RiArrowUpSFill,
  RiListUnordered,
  RiDashboardLine,
  RiLayout4Line,
  RiLineChartLine,
  RiSearchLine,
} from 'react-icons/ri';
import {
  setFundSortModeAction,
  troggleFundSortOrderAction,
  setZindexSortModeAction,
  troggleZindexSortOrderAction,
  setQuotationSortModeAction,
  troggleQuotationSortOrderAction,
  setFundViewModeAction,
  setZindexViewModeAction,
  setQuotationViewModeAction,
} from '@/store/features/sort';
import CustomDrawer from '@/components/CustomDrawer';
import { toggleAllZindexsCollapseAction } from '@/store/features/zindex';
import { toggleAllQuotationsCollapseAction } from '@/store/features/quotation';
import { toggleAllFundsCollapseAction } from '@/store/features/wallet';
import { useFreshFunds, useFreshZindexs, useAppDispatch, useAppSelector } from '@/utils/hooks';
import * as Enums from '@/utils/enums';
import * as Helpers from '@/helpers';
import styles from './index.module.css';

const ManageFundContent = React.lazy(() => import('@/components/Home/FundView/ManageFundContent'));
const AddFundContent = React.lazy(() => import('@/components/Home/FundView/AddFundContent'));
const FundStatisticsContent = React.lazy(() => import('@/components/Home/FundView/FundStatisticsContent'));
const ManageZindexContent = React.lazy(() => import('@/components/Home/ZindexView/ManageZindexContent'));
const AddZindexContent = React.lazy(() => import('@/components/Home/ZindexView/AddZindexContent'));
const FundFlowContent = React.lazy(() => import('@/components/Home/QuotationView/FundFlowContent'));
const NewsContent = React.lazy(() => import('@/components/Home/NewsList/NewsContent'));
const FundRankingContent = React.lazy(() => import('@/components/Home/FundView/FundRankingContent'));

export interface SortBarProps {}

function FundsSortBar() {
  const dispatch = useAppDispatch();

  const {
    fundSortMode: { type: fundSortType, order: fundSortOrder },
  } = useAppSelector((state) => state.sort.sortMode);

  const {
    fundViewMode: { type: fundViewType },
  } = useAppSelector((state) => state.sort.viewMode);

  const funds = useAppSelector((state) => state.wallet.currentWallet.funds);

  const { fundSortModeOptions, fundSortModeOptionsMap } = Helpers.Sort.GetSortConfig();

  const [showManageFundDrawer, { setTrue: openManageFundDrawer, setFalse: closeManageFundDrawer }] = useBoolean(false);
  const [showAddFundDrawer, { setTrue: openAddFundDrawer, setFalse: closeAddFundDrawer }] = useBoolean(false);
  const [showFundRankingDrawer, { setTrue: openFundRankingDrawer, setFalse: closeFundRankingDrawer }] = useBoolean(false);

  const expandAllFunds = funds.every((_) => _.collapse);

  const freshFunds = useFreshFunds();

  const toggleFundsCollapse = () => dispatch(toggleAllFundsCollapseAction());

  return (
    <div className={styles.bar}>
      <div className={styles.arrow} onClick={toggleFundsCollapse}>
        {expandAllFunds ? <RiArrowUpSLine /> : <RiArrowDownSLine />}
      </div>
      <div className={styles.name} onClick={toggleFundsCollapse}>
        <span>基金名称</span>
        <a
          onClick={(e) => {
            openManageFundDrawer();
            e.stopPropagation();
          }}
        >
          管理
        </a>
        <a
          onClick={(e) => {
            openFundRankingDrawer();
            e.stopPropagation();
          }}
        >
          榜单
        </a>
        <div className={styles.view}>
          <RiSearchLine
            onClick={(e) => {
              openAddFundDrawer();
              e.stopPropagation();
            }}
          />
        </div>
      </div>
      <div className={styles.view}>
        {fundViewType === Enums.FundViewType.List && (
          <RiListUnordered onClick={() => dispatch(setFundViewModeAction({ type: Enums.FundViewType.Grid }))} />
        )}
        {fundViewType === Enums.FundViewType.Grid && (
          <RiDashboardLine onClick={() => dispatch(setFundViewModeAction({ type: Enums.FundViewType.List }))} />
        )}
      </div>
      <div className={styles.mode}>
        <Dropdown
          placement="bottomRight"
          popupRender={() => (
            <Menu
              selectedKeys={[String(fundSortModeOptionsMap[fundSortType].key)]}
              onClick={({ key }) => dispatch(setFundSortModeAction({ type: Number(key) as Enums.FundSortType }))}
              items={fundSortModeOptions as any}
            />
          )}
        >
          <a>{fundSortModeOptionsMap[fundSortType].label}</a>
        </Dropdown>
      </div>
      <div className={styles.sort} onClick={() => dispatch(troggleFundSortOrderAction())}>
        <RiArrowUpSFill
          className={clsx({
            [styles.selectOrder]: fundSortOrder === Enums.SortOrderType.Asc,
          })}
        />
        <RiArrowDownSFill
          className={clsx({
            [styles.selectOrder]: fundSortOrder === Enums.SortOrderType.Desc,
          })}
        />
      </div>
      <CustomDrawer show={showManageFundDrawer}>
        <ManageFundContent
          onClose={closeManageFundDrawer}
          onEnter={() => {
            freshFunds();
            closeManageFundDrawer();
          }}
        />
      </CustomDrawer>
      <CustomDrawer show={showAddFundDrawer}>
        <AddFundContent
          onClose={closeAddFundDrawer}
          onEnter={() => {
            freshFunds();
            closeAddFundDrawer();
          }}
        />
      </CustomDrawer>
      <CustomDrawer show={showFundRankingDrawer}>
        <FundRankingContent onClose={closeFundRankingDrawer} onEnter={closeFundRankingDrawer} />
      </CustomDrawer>
    </div>
  );
}

function ZindexSortBar() {
  const dispatch = useAppDispatch();

  const {
    zindexSortMode: { type: zindexSortType, order: zindexSortOrder },
  } = useAppSelector((state) => state.sort.sortMode);

  const {
    zindexViewMode: { type: zindexViewType },
  } = useAppSelector((state) => state.sort.viewMode);

  const { zindexSortModeOptions, zindexSortModeOptionsMap } = Helpers.Sort.GetSortConfig();

  const zindexs = useAppSelector((state) => state.zindex.zindexs);

  const [showManageZindexDrawer, { setTrue: openManageZindexDrawer, setFalse: closeManageZindexDrawer }] = useBoolean(false);
  const [showAddZindexDrawer, { setTrue: openAddZindexDrawer, setFalse: closeAddZindexDrawer }] = useBoolean(false);
  const [showNewsDrawer, { setTrue: openNewsDrawer, setFalse: closeNewsDrawer }] = useBoolean(false);

  const expandAllZindexs = zindexs.every((_) => _.collapse);

  const freshZindexs = useFreshZindexs();

  const toggleZindexsCollapse = () => dispatch(toggleAllZindexsCollapseAction());

  return (
    <div className={styles.bar}>
      <div className={styles.arrow} onClick={toggleZindexsCollapse}>
        {expandAllZindexs ? <RiArrowUpSLine /> : <RiArrowDownSLine />}
      </div>
      <div className={styles.name} onClick={toggleZindexsCollapse}>
        <span>指数名称</span>
        <a
          onClick={(e) => {
            openManageZindexDrawer();
            e.stopPropagation();
          }}
        >
          管理
        </a>
        <a
          onClick={(e) => {
            openNewsDrawer();
            e.stopPropagation();
          }}
        >
          新闻
        </a>
        <div className={styles.view}>
          <RiSearchLine
            onClick={(e) => {
              openAddZindexDrawer();
              e.stopPropagation();
            }}
          />
        </div>
      </div>
      <div className={styles.view}>
        {zindexViewType === Enums.ZindexViewType.List && (
          <RiListUnordered onClick={() => dispatch(setZindexViewModeAction({ type: Enums.ZindexViewType.Grid }))} />
        )}
        {zindexViewType === Enums.ZindexViewType.Grid && (
          <RiDashboardLine onClick={() => dispatch(setZindexViewModeAction({ type: Enums.ZindexViewType.Chart }))} />
        )}
        {zindexViewType === Enums.ZindexViewType.Chart && (
          <RiLineChartLine onClick={() => dispatch(setZindexViewModeAction({ type: Enums.ZindexViewType.List }))} />
        )}
      </div>
      <div className={styles.mode}>
        <Dropdown
          placement="bottomRight"
          popupRender={() => (
            <Menu
              selectedKeys={[String(zindexSortModeOptionsMap[zindexSortType].key)]}
              onClick={({ key }) => dispatch(setZindexSortModeAction({ type: Number(key) as Enums.ZindexSortType }))}
              items={zindexSortModeOptions as any}
            />
          )}
        >
          <a>{zindexSortModeOptionsMap[zindexSortType].label}</a>
        </Dropdown>
      </div>
      <div className={styles.sort} onClick={() => dispatch(troggleZindexSortOrderAction())}>
        <RiArrowUpSFill
          className={clsx({
            [styles.selectOrder]: zindexSortOrder === Enums.SortOrderType.Asc,
          })}
        />
        <RiArrowDownSFill
          className={clsx({
            [styles.selectOrder]: zindexSortOrder === Enums.SortOrderType.Desc,
          })}
        />
      </div>
      <CustomDrawer show={showManageZindexDrawer}>
        <ManageZindexContent
          onClose={closeManageZindexDrawer}
          onEnter={() => {
            freshZindexs();
            closeManageZindexDrawer();
          }}
        />
      </CustomDrawer>
      <CustomDrawer show={showAddZindexDrawer}>
        <AddZindexContent
          onClose={closeAddZindexDrawer}
          onEnter={() => {
            freshZindexs();
            closeAddZindexDrawer();
          }}
        />
      </CustomDrawer>
      <CustomDrawer show={showNewsDrawer}>
        <NewsContent onClose={closeNewsDrawer} onEnter={closeNewsDrawer} />
      </CustomDrawer>
    </div>
  );
}

function QuotationSortBar() {
  const dispatch = useAppDispatch();

  const {
    quotationSortMode: { type: quotationSortType, order: quotationSortOrder },
  } = useAppSelector((state) => state.sort.sortMode);

  const {
    quotationViewMode: { type: quotationViewType },
  } = useAppSelector((state) => state.sort.viewMode);

  const [showFundFlowDrawer, { setTrue: openFundFlowDrawer, setFalse: closeFundFlowDrawer }] = useBoolean(false);
  const [showFundsStatisticsDrawer, { setTrue: openFundStatisticsDrawer, setFalse: closeFundStatisticsDrawer }] =
    useBoolean(false);

  const { quotationSortModeOptions, quotationSortModeOptionsMap } = Helpers.Sort.GetSortConfig();

  const quotations = useAppSelector((state) => state.quotation.quotations);

  const expandAllQuotations = quotations.every((_) => _.collapse);

  const toggleQuotationsCollapse = () => dispatch(toggleAllQuotationsCollapseAction());

  return (
    <div className={styles.bar}>
      <div className={styles.arrow} onClick={toggleQuotationsCollapse}>
        {expandAllQuotations ? <RiArrowUpSLine /> : <RiArrowDownSLine />}
      </div>
      <div className={styles.name} onClick={toggleQuotationsCollapse}>
        <span>板块名称</span>
        <a
          onClick={(e) => {
            openFundFlowDrawer();
            e.stopPropagation();
          }}
        >
          资金流
        </a>
        <a
          onClick={(e) => {
            openFundStatisticsDrawer();
            e.stopPropagation();
          }}
        >
          统计
        </a>
      </div>
      <div className={styles.view}>
        {quotationViewType === Enums.QuotationViewType.List && (
          <RiListUnordered onClick={() => dispatch(setQuotationViewModeAction({ type: Enums.QuotationViewType.Grid }))} />
        )}
        {quotationViewType === Enums.QuotationViewType.Grid && (
          <RiDashboardLine onClick={() => dispatch(setQuotationViewModeAction({ type: Enums.QuotationViewType.Flow }))} />
        )}
        {quotationViewType === Enums.QuotationViewType.Flow && (
          <RiLayout4Line onClick={() => dispatch(setQuotationViewModeAction({ type: Enums.QuotationViewType.List }))} />
        )}
      </div>
      <div className={styles.mode}>
        <Dropdown
          placement="bottomRight"
          popupRender={() => (
            <Menu
              selectedKeys={[String(quotationSortModeOptionsMap[quotationSortType].key)]}
              onClick={({ key }) => dispatch(setQuotationSortModeAction({ type: Number(key) as Enums.QuotationSortType }))}
              items={quotationSortModeOptions as any}
            />
          )}
        >
          <a>{quotationSortModeOptionsMap[quotationSortType].label}</a>
        </Dropdown>
      </div>
      <div className={styles.sort} onClick={() => dispatch(troggleQuotationSortOrderAction())}>
        <RiArrowUpSFill
          className={clsx({
            [styles.selectOrder]: quotationSortOrder === Enums.SortOrderType.Asc,
          })}
        />
        <RiArrowDownSFill
          className={clsx({
            [styles.selectOrder]: quotationSortOrder === Enums.SortOrderType.Desc,
          })}
        />
      </div>
      <CustomDrawer show={showFundFlowDrawer}>
        <FundFlowContent onClose={closeFundFlowDrawer} onEnter={closeFundFlowDrawer} />
      </CustomDrawer>
      <CustomDrawer show={showFundsStatisticsDrawer}>
        <FundStatisticsContent onClose={closeFundStatisticsDrawer} onEnter={closeFundStatisticsDrawer} />
      </CustomDrawer>
    </div>
  );
}

const SortBar: React.FC<SortBarProps> = () => {
  const [visible, setVisible] = useState(true);
  const { run: debounceSetVisible } = useDebounceFn(() => setVisible(true), {
    wait: 200,
  });
  const tabsActiveKey = useAppSelector((state) => state.tabs.activeKey);

  useScroll(document, () => {
    setVisible(false);
    debounceSetVisible();
    return true;
  });

  const renderSortBar = (() => {
    switch (tabsActiveKey) {
      case Enums.TabKeyType.Fund:
        return <FundsSortBar />;
      case Enums.TabKeyType.Zindex:
        return <ZindexSortBar />;
      case Enums.TabKeyType.Quotation:
        return <QuotationSortBar />;
      default:
        return <></>;
    }
  })();

  return <div className={clsx(styles.content, { [styles.visible]: visible })}>{renderSortBar}</div>;
};

export default SortBar;
