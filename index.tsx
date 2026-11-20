import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root  = document.getElementById('root') as HTMLElement;

import './index.css';

import App from './App1';
// import ChatComponent from './chat';
// import Virtual from './virtual/virtual';

createRoot(root).render(
    <StrictMode>
        <App/>
        {/* <ChatComponent/> */}
        {/* <Virtual/> */}
    </StrictMode>
)