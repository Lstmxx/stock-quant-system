import { App as AntdApp, ConfigProvider } from 'antd'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'

function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#e8f57a',
          colorText: '#f4f7fb',
          colorTextSecondary: '#b7c3d1',
          colorTextTertiary: '#8c9aaa',
          colorTextPlaceholder: '#91a0b1',
          colorBorder: '#5f7084',
          colorBorderSecondary: '#344252',
          colorBgBase: '#080b12',
          colorBgContainer: '#111a25',
          colorBgElevated: '#182331',
          colorError: '#ff9b94',
          colorWarning: '#ffd27d',
          colorSuccess: '#8fe3b0',
          colorInfo: '#8fb7ff',
          colorTextLightSolid: '#10150d',
        },
        components: {
          Input: { colorBgContainer: '#111a25', colorText: '#f4f7fb', colorTextPlaceholder: '#91a0b1', activeBorderColor: '#e8f57a', hoverBorderColor: '#8493a4' },
          Select: { colorBgContainer: '#111a25', optionSelectedBg: '#182331', colorText: '#f4f7fb' },
          Button: { defaultBg: '#182331', defaultColor: '#f4f7fb', defaultBorderColor: '#5f7084', primaryColor: '#10150d' },
          Table: { headerBg: '#182331', rowHoverBg: 'rgba(232,245,122,.04)', borderColor: '#344252', colorText: '#f4f7fb' },
          Modal: { contentBg: '#182331', headerBg: '#182331' },
          Drawer: { colorBgElevated: '#182331' },
          Tooltip: { colorBgSpotlight: '#182331', colorTextLightSolid: '#f4f7fb' },
          Alert: {
            colorInfoBg: '#182331', colorInfoBorder: '#8fb7ff', colorInfoText: '#f4f7fb',
            colorSuccessBg: '#182331', colorSuccessBorder: '#8fe3b0', colorSuccessText: '#f4f7fb',
            colorWarningBg: '#182331', colorWarningBorder: '#ffd27d', colorWarningText: '#f4f7fb',
            colorErrorBg: '#182331', colorErrorBorder: '#ff9b94', colorErrorText: '#f4f7fb',
          },
        },
      }}
    >
      <AntdApp>
        <RouterProvider router={router} />
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
