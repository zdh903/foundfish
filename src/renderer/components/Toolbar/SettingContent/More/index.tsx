import React from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { RiLink, RiGroupLine, RiTerminalBoxLine } from 'react-icons/ri';
import StandCard from '@/components/Card/StandCard';
import PayCarousel from '@/components/PayCarousel';
import Guide from '@/components/Guide';
import * as Utils from '@/utils';
import styles from '../index.module.css';

interface MoreProps {}

const { shell, clipboard, dialog } = window.contextModules.electron;
const process = window.contextModules.process;

const linksGroup = Utils.Group(
  [
    {
      url: 'https://www.ggtime.com/tools/fundfish',
      name: '官方网站',
    },
    {
      url: 'https://github.com/foundfish/foundfish',
      name: '更新日志',
    },
  ],
  3
);

const More: React.FC<MoreProps> = () => {
  function onCopyGroup(number: string) {
    clipboard.writeText(number);
    dialog.showMessageBox({
      title: '复制成功',
      type: 'info',
      message: `已复制到粘贴板`,
    });
  }

  function onNavigate(url: string) {
    shell.openExternal(url);
  }

  return (
    <div className={styles.content}>
      <PayCarousel />
      <StandCard
        icon={<RiLink />}
        title="关于 FoundFish"
        extra={
          <div className={styles.guide}>
            <Guide list={[{ name: '☕️', text: 'buy me a coffee :)' }]} />
          </div>
        }
      >
        <div className={clsx('card-body')}>
          <div className={clsx(styles.describe)}>
            {
              'FoundFish 基于开源项目 Fishing Funds 二次开发。因原版依赖的盘中估值接口已失效且不再维护，本版采用持仓加权估算等替代算法，仍可查看实时估值。由于数据源限制，准确度较原版有所降低，仅作参考，请以基金公司披露的实际净值为准。'
            }
          </div>
          {linksGroup.map((links, index) => (
            <div key={index} className={styles.link}>
              {links.map((link) => (
                <React.Fragment key={link.name}>
                  <a onClick={() => onNavigate(link.url)}>{link.name}</a>
                  <i />
                </React.Fragment>
              ))}
            </div>
          ))}
        </div>
      </StandCard>
      <StandCard icon={<RiGroupLine />} title="讨论交流">
        <div className={clsx(styles.group, 'card-body')}>
          <section>
            <label>QQ群：</label>
            <a onClick={() => onCopyGroup('51339012')}>51339012</a>
          </section>
        </div>
      </StandCard>
      <StandCard icon={<RiTerminalBoxLine />} title="构建信息">
        <div className={clsx(styles.buildGroup, 'card-body')}>
          <section>
            <label>Electron：</label>
            <div>{process.electron}</div>
          </section>
          <section>
            <label>Node.js：</label>
            <div>{process.node}</div>
          </section>
          <section>
            <label>Chromium：</label>
            <div>{process.chrome}</div>
          </section>
          <section>
            <label>V8：</label>
            <div>{process.v8}</div>
          </section>
          <section>
            <label>OS：</label>
            <div>
              {process.platform} {process.arch}
            </div>
          </section>
          <section>
            <label>Sandboxed：</label>
            <div>{String(process.sandboxed)}</div>
          </section>
          <section>
            <label>构建日期：</label>
            <div>{dayjs(process.buildDate).format('YYYYMMDDHHmmss')}</div>
          </section>
        </div>
      </StandCard>
    </div>
  );
};

export default More;
