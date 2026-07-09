import React, { useState } from 'react';
import { Layout, Menu, Typography, Avatar, Dropdown } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { 
  DashboardOutlined, 
  LogoutOutlined, 
  StockOutlined,
  RobotOutlined,
  DatabaseOutlined,
  FunctionOutlined,
  AppstoreOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { authClient } from '../../api/auth-client';
import { useAuthStore } from '../../features/auth/store';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const pageMap: Record<string, { icon: React.ReactNode; title: string }> = {
  '/dashboard': { icon: <DashboardOutlined />, title: 'Dashboard' },
  '/llm': { icon: <RobotOutlined />, title: '大模型管理' },
  '/data': { icon: <DatabaseOutlined />, title: '股票数据管理' },
  '/factor/tasks': { icon: <AppstoreOutlined />, title: '因子任务' },
  '/factor/list': { icon: <UnorderedListOutlined />, title: '因子列表' },
};

const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setUser } = useAuthStore();

  const handleLogout = async () => {
    await authClient.signOut();
    setUser(null);
    navigate('/login');
  };

  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: 'Dashboard',
    },
    {
      key: '/llm',
      icon: <RobotOutlined />,
      label: '大模型管理',
    },
    {
      key: '/data',
      icon: <DatabaseOutlined />,
      label: '股票数据管理',
    },
    {
      key: '/factor',
      icon: <FunctionOutlined />,
      label: '因子管理',
      children: [
        {
          key: '/factor/tasks',
          icon: <AppstoreOutlined />,
          label: '因子任务',
        },
        {
          key: '/factor/list',
          icon: <UnorderedListOutlined />,
          label: '因子列表',
        },
      ]
    }
  ];

  const currentPage = pageMap[location.pathname];

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Sider 
        collapsible 
        collapsed={collapsed} 
        onCollapse={(value) => setCollapsed(value)}
        theme="light"
      >
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', borderBottom: '1px solid #f0f0f0' }}>
          <StockOutlined style={{ fontSize: 24, color: '#1677ff', marginRight: collapsed ? 0 : 8 }} />
          {!collapsed && <Text strong style={{ fontSize: 16 }}>Stock Quant</Text>}
        </div>
        <Menu 
          theme="light" 
          mode="inline" 
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Header style={{ padding: '0 24px', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 4px rgba(0,21,41,0.08)', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {currentPage && (
              <>
                <span style={{ fontSize: 18, color: '#1677ff', display: 'flex', alignItems: 'center' }}>
                  {currentPage.icon}
                </span>
                <Text strong style={{ fontSize: 16 }}>{currentPage.title}</Text>
              </>
            )}
          </div>
          {user && (
            <Dropdown 
              menu={{ 
                items: [
                  {
                    key: 'logout',
                    icon: <LogoutOutlined />,
                    label: '退出登录',
                    danger: true,
                    onClick: handleLogout
                  }
                ] 
              }} 
              placement="bottomRight"
            >
              <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', borderRadius: 6, transition: 'background-color 0.3s' }} className="user-dropdown-trigger">
                <Avatar size="small" style={{ backgroundColor: '#1677ff' }}>{user.name?.charAt(0) || user.email?.charAt(0)}</Avatar>
                <Text style={{ fontSize: 14 }}>{user.name || user.email}</Text>
              </div>
            </Dropdown>
          )}
        </Header>
        <Content style={{ margin: '24px', flex: 1, minHeight: 0, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
