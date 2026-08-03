import React, { useState } from 'react';
import { Alert, App as AntdApp, Button, Form, Input } from 'antd';
import { ArrowRight, KeyRound, Mail, ScanLine } from 'lucide-react';
import { authClient } from '../../api/auth-client';
import { useAuthStore } from './store';
import { useNavigate } from 'react-router-dom';

interface LoginValues { email: string; password: string }

function getAuthErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    if (code === 'INVALID_EMAIL_OR_PASSWORD') return '邮箱或密码错误，请检查后重试';
    const message = 'message' in error && typeof error.message === 'string' ? error.message : undefined;
    if (message) return message;
  }
  if (error instanceof Error) return error.message;
  return '登录失败，请稍后重试';
}

const Login: React.FC = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [form] = Form.useForm();
  const { fetchSession } = useAuthStore();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();

  const handleSubmit = async (values: LoginValues) => {
    setLoading(true); setErrorMessage('');
    try {
      if (isSignUp) await authClient.signUp.email({ email: values.email, password: values.password, name: values.email.split('@')[0] });
      else await authClient.signIn.email({ email: values.email, password: values.password });
      await fetchSession(); navigate('/data');
    } catch (error: unknown) {
      const nextErrorMessage = getAuthErrorMessage(error);
      setErrorMessage(nextErrorMessage);
      message.error(nextErrorMessage);
    } finally { setLoading(false); }
  };

  return <div className="login-panel">
    <div className="login-panel-top"><span className="eyebrow-label"><ScanLine size={14} /> PRIVATE TERMINAL</span><span className="terminal-code">AUTH_0x01</span></div>
    <h1>{isSignUp ? <>Build your<br /><em>edge.</em></> : <>Welcome<br /><em>back.</em></>}</h1>
    <p className="login-intro">{isSignUp ? 'Create a secure workspace for your quantitative research.' : 'Your research environment is ready when you are.'}</p>
    {errorMessage && <Alert title={errorMessage} type="error" showIcon style={{ marginBottom: 20 }} />}
    <Form form={form} onFinish={handleSubmit} layout="vertical" requiredMark={false}>
      <Form.Item name="email" label="IDENTITY / EMAIL" rules={[{ required: true, message: 'Please input your email!' }, { type: 'email', message: 'Invalid email' }]}>
        <Input prefix={<Mail size={16} />} placeholder="you@domain.com" autoComplete="email" />
      </Form.Item>
      <Form.Item name="password" label="ACCESS KEY" rules={[{ required: true, message: 'Please input your password!' }, { min: 8, message: 'Must be at least 8 characters' }]}>
        <Input.Password prefix={<KeyRound size={16} />} placeholder="Minimum 8 characters" autoComplete={isSignUp ? 'new-password' : 'current-password'} />
      </Form.Item>
      <Button className="login-submit" type="primary" htmlType="submit" block loading={loading}>{isSignUp ? 'CREATE WORKSPACE' : 'ENTER WORKSPACE'} <ArrowRight size={17} /></Button>
    </Form>
    <div className="login-switch">{isSignUp ? 'Already have an account?' : "Don't have an account?"}<button type="button" onClick={() => { setIsSignUp(!isSignUp); setErrorMessage(''); }}>{isSignUp ? 'Sign in' : 'Sign up'}</button></div>
  </div>;
};

export default Login;
