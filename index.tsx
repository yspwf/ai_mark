import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root  = document.getElementById('root') as HTMLElement;

import App from './App1';

createRoot(root).render(
    <StrictMode>
        <App/>
    </StrictMode>
)