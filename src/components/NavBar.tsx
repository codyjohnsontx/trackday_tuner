// import { Link } from 'react-router-dom';

export default function NavBar() {
  return (
    <nav className="nav">
      <a href="/" className="site-title">
        TrackDay Tuner
      </a>
      <ul>
        <li>
          <a href="/">Home</a>
        </li>
        <li>
          <a href="/About">About</a>
        </li>
        <li>
          <a href="/Hamburger">Nav Hamburger</a>
        </li>
      </ul>
    </nav>
  );
}
