# Bheemz Kitchen App

Welcome to the Bheemz Kitchen App! This project is designed to provide users with a delightful experience in exploring various kitchen recipes and culinary tips.

## Project Overview

The Bheemz Kitchen App features a landing page that showcases the essence of cooking and the joy of preparing meals. The app is built using HTML, CSS, and JavaScript, ensuring a responsive and interactive user experience.

## Project Structure

```
bheemz-kitchen-app
├── landingpage.html   # HTML structure for the landing page
├── layout.css         # CSS styles for the landing page
├── script.js          # JavaScript for interactivity
└── README.md          # Project documentation
```

## Setup Instructions

1. **Clone the repository**:
   ```
   git clone <repository-url>
   ```

2. **Navigate to the project directory**:
   ```
   cd bheemz-kitchen-app
   ```

### Email configuration

Render PostgreSQL: add the database's internal connection string as `DATABASE_URL` in the web service environment. The app uses PostgreSQL for users, profiles, and meals whenever `DATABASE_URL` is present; memory storage is only used when no database is configured.

Set `FRONTEND_SUCCESS_URL=https://bheemz-kitchen-2.onrender.com` and remove any old `FRONTEND_SUCCESS_URL` value containing `192.168.`, `localhost`, or another private address. This is the address used in verification and payment links.

Set these environment variables on the server (Render: **Dashboard > Environment**):

```text
SMTP_EMAIL=your-gmail-address@gmail.com
SMTP_APP_PASSWORD=your-16-character-google-app-password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM=your-gmail-address@gmail.com
```

For Gmail, enable 2-Step Verification and create an App Password. A normal Gmail password will not work. Restart/redeploy the service after adding the variables.

3. **Open the landing page**:
   Open `landingpage.html` in your web browser to view the app.

## Contributing

Contributions are welcome! If you have suggestions or improvements, feel free to submit a pull request.

## License

This project is licensed under the MIT License. See the LICENSE file for details.