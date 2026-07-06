import React, { useState } from 'react';
import { Layout, Menu, Button, Typography, Avatar, Flex, Dropdown } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { 
  DashboardOutlined, 
  LogoutOutlined, 
  StockOutlined,
  RobotOutlined
} from '@ant-design/icons';
import { authClient } from '../../api/auth-client';
import { useAuthStore } from '../../features/auth/store';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

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
    }
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
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
      <Layout>
        <Header style={{ padding: '0 24px', background: '#fff', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', boxShadow: '0 1px 4px rgba(0,21,41,0.08)', zIndex: 1 }}>
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
        <Content style={{ margin: '16px', padding: 24, background: '#fff', borderRadius: 8 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
