import React from 'react';
import { Modal, ModalProps } from 'antd';

export const BaseModal: React.FC<ModalProps> = (props) => {
  return (
    <Modal
      destroyOnHidden
      mask={{ closable: false }}
      centered
      {...props}
    />
  );
};
