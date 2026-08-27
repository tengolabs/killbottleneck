import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function PageNotFound() {
    const { t } = useTranslation('nav');
    const location = useLocation();
    const pageName = location.pathname.substring(1);

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
            <div className="max-w-md w-full">
                <div className="text-center space-y-6">
                    {/* 404 Error Code */}
                    <div className="space-y-2">
                        <h1 className="text-7xl font-light text-slate-300 dark:text-slate-600">404</h1>
                        <div className="h-0.5 w-16 bg-slate-200 dark:bg-slate-700 mx-auto"></div>
                    </div>
                    
                    {/* Main Message */}
                    <div className="space-y-3">
                        <h2 className="text-2xl font-medium text-slate-800 dark:text-slate-200">
                            {t('notFound.title')}
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            {t('notFound.descBefore')} <span className="font-medium text-slate-700 dark:text-slate-300">&quot;{pageName}&quot;</span> {t('notFound.descAfter')}
                        </p>
                    </div>

                    {/* Action Button */}
                    <div className="pt-6">
                        <button 
                            onClick={() => window.location.href = '/'} 
                            className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500"
                        >
                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                            </svg>
                            {t('notFound.goHome')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}