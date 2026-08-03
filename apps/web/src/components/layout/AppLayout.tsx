import React, { useMemo, useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Button } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Activity,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Database,
  FlaskConical,
  Layers3,
  LogOut,
  Menu as MenuIcon,
  Network,
  ScanSearch,
  Sparkles,
} from 'lucide-react';
import { authClient } from '../../api/auth-client';
import { useAuthStore } from '../../features/auth/store';

const { Header, Sider, Content } = Layout;
const pageMap: Record<string, { icon: React.ReactNode; title: string; eyebrow: string }> = {
  '/llm': { icon: <BrainCircuit size={17} />, title: '大模型管理', eyebrow: 'MODEL OPS' },
  '/llm-selection': { icon: <ScanSearch size={17} />, title: 'LLM 选股', eyebrow: 'SIGNAL LAB' },
  '/data': { icon: <Database size={17} />, title: '股票数据管理', eyebrow: 'DATA STREAM' },
  '/factor/tasks': { icon: <Layers3 size={17} />, title: '因子任务', eyebrow: 'FACTOR LAB' },
  '/factor/list': { icon: <Network size={17} />, title: '因子列表', eyebrow: 'FACTOR INDEX' },
  '/factor/selection': { icon: <ScanSearch size={17} />, title: '因子选股', eyebrow: 'SIGNAL LAB' },
};

const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setUser } = useAuthStore();
  const currentPage = pageMap[location.pathname] ?? pageMap['/data'];

  const handleLogout = async () => {
    await authClient.signOut();
    setUser(null);
    navigate('/login');
  };

  const menuItems = useMemo(() => [
    { key: '/llm', icon: <BrainCircuit size={17} />, label: '大模型管理' },
    { key: '/llm-selection', icon: <ScanSearch size={17} />, label: 'LLM 选股' },
    { key: '/data', icon: <Database size={17} />, label: '股票数据管理' },
    {
      key: '/factor', icon: <FlaskConical size={17} />, label: '因子管理',
      children: [
        { key: '/factor/tasks', icon: <Layers3 size={16} />, label: '因子任务' },
        { key: '/factor/list', icon: <Network size={16} />, label: '因子列表' },
        { key: '/factor/selection', icon: <ScanSearch size={16} />, label: '因子选股' },
      ],
    },
  ], []);

  return (
    <Layout className="app-shell">
      <Sider
        className="app-sider"
        collapsible
        collapsed={collapsed}
        trigger={null}
        width={248}
        collapsedWidth={76}
        breakpoint="lg"
        onBreakpoint={(broken) => setCollapsed(broken)}
        theme="light"
      >
        <div className="brand-mark">
          <div className="brand-symbol"><Activity size={21} strokeWidth={2.5} /></div>
          {!collapsed && <div><div className="brand-name">STOCK<span>QUANT</span></div><div className="brand-subtitle">RESEARCH OS / 01</div></div>}
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <Menu
          className="app-menu"
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={['/factor']}
          items={menuItems}
          onClick={({ key }) => { navigate(key); setMobileOpen(false); }}
        />
        <div className="sider-footer">
          <div className="system-status"><span className="status-dot" />{!collapsed && <span>SYSTEMS NOMINAL</span>}</div>
          {!collapsed && <div className="version-label">BUILD 2026.08 / CN-SH</div>}
        </div>
      </Sider>
      <Layout className="app-main">
        <Header className="app-header">
          <div className="header-context">
            <Button className="mobile-menu-button" type="text" icon={<MenuIcon size={19} />} onClick={() => setMobileOpen(!mobileOpen)} aria-label="打开导航" />
            <div className="page-kicker"><span className="kicker-line" />{currentPage.eyebrow}</div>
            <div className="page-title">{currentPage.title}</div>
          </div>
          <div className="header-actions">
            <div className="live-chip"><Sparkles size={13} /> LIVE / SHANGHAI</div>
            {user && <Dropdown menu={{ items: [{ key: 'logout', icon: <LogOut size={15} />, label: '退出登录', danger: true, onClick: handleLogout }] }} placement="bottomRight">
              <button className="user-trigger" type="button"><Avatar size={30} className="user-avatar">{user.name?.charAt(0) || user.email?.charAt(0)}</Avatar><span>{user.name || user.email}</span><ChevronRight size={14} /></button>
            </Dropdown>}
            <Button className="collapse-button" type="text" icon={collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />} onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? '展开导航' : '收起导航'} />
          </div>
        </Header>
        {mobileOpen && <div className="mobile-nav-overlay" onClick={() => setMobileOpen(false)}><div className="mobile-nav-panel" onClick={(event) => event.stopPropagation()}><Menu className="app-menu" mode="inline" selectedKeys={[location.pathname]} items={menuItems} onClick={({ key }) => { navigate(key); setMobileOpen(false); }} /></div></div>}
        <Content className="app-content"><div className="content-canvas"><Outlet /></div></Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
