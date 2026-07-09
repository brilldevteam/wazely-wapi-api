import EmailTemplateService from '../services/email-template.service.js';

const getLoginUrl = () => {
  const baseUrl =
    process.env.FRONTEND_URL ||
    process.env.APP_FRONTEND_URL ||
    'http://localhost:3000';

  return `${baseUrl.replace(/\/$/, '')}/auth/login`;
};

export const sendAccountCredentialsEmail = async ({
  name,
  email,
  password,
  role,
  teamName = '',
}) => {
  try {
    return await EmailTemplateService.send('account-credentials', email, {
      user_name: name,
      user_email: email,
      user_password: password,
      user_role: role,
      team_name: teamName,
      login_url: getLoginUrl(),
    });
  } catch (error) {
    console.error('Error sending account credentials email:', error);
    return false;
  }
};
