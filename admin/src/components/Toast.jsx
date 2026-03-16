import React, { useEffect } from 'react';

const Toast = ({ message, type = 'success', onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`toast toast-${type}`}>
      <div className="toast-icon">
        {type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}
      </div>
      <div className="toast-message">{message}</div>
      <button className="toast-close" onClick={onClose}>×</button>
    </div>
  );
};

export default Toast;
