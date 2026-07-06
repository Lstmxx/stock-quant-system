import React, { useState } from 'react';
import { Card, Form, Input, Button, Alert, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { authClient } from '../../api/auth-client';
import { useAuthStore } from './store';
import { useNavigate } from 'react-router-dom';

const { Text, Link } = Typography;

const Login: React.FC = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [form] = Form.useForm();
  
  const { fetchSession } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (values: any) => {
    setLoading(true);
    setErrorMessage('');
    try {
      if (isSignUp) {
        await authClient.signUp.email({
          email: values.email,
          password: values.password,
          name: values.email.split('@')[0]
        });
      } else {
        await authClient.signIn.email({
          email: values.email,
          password: values.password
        });
      }
      await fetchSession();
      navigate('/dashboard');
    } catch (e: any) {
      setErrorMessage(e.message || 'An error occurred during login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card 
      style={{ width: '100%', maxWidth: 400 }} 
      title={<div style={{ textAlign: 'center', fontSize: 24 }}>{isSignUp ? 'Create an account' : 'Welcome back!'}</div>}
    >
      <div style={{ textAlign: 'center', marginBottom: 24, color: 'gray' }}>
        {isSignUp ? 'Sign up to get started.' : 'Sign in to your account.'}
      </div>

      {errorMessage && (
        <Alert message={errorMessage} type="error" showIcon style={{ marginBottom: 24 }} />
      )}

      <Form form={form} onFinish={handleSubmit} layout="vertical">
        <Form.Item
          name="email"
          label="Email"
          rules={[{ required: true, message: 'Please input your email!' }, { type: 'email', message: 'Invalid email' }]}
        >
          <Input prefix={<UserOutlined />} placeholder="Enter your email" />
        </Form.Item>

        <Form.Item
          name="password"
          label="Password"
          rules={[{ required: true, message: 'Please input your password!' }, { min: 8, message: 'Must be at least 8 characters' }]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="Enter your password" />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            {isSignUp ? 'Sign up' : 'Sign in'}
          </Button>
        </Form.Item>
      </Form>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Text type="secondary">
          {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
        </Text>
        <Link onClick={() => { setIsSignUp(!isSignUp); setErrorMessage(''); }}>
          {isSignUp ? 'Sign in' : 'Sign up'}
        </Link>
      </div>
    </Card>
  );
};

export default Login;
