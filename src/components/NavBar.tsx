// src/components/NavBar.tsx
import { Link } from 'react-router-dom';

export default function NavBar() {
  return (
    <nav className="flex items-center justify-between bg-black px-4 py-2 text-white">
      <Link to="/" className="text-red-500 text-xl font-bold">
        Track Day Tuner
      </Link>
      <ul className="flex space-x-4">
        <li>
          <Link to="/pricing" className="hover:text-red-400">
            Pricing
          </Link>
        </li>
        <li>
          <Link to="/about" className="hover:text-red-400">
            About
          </Link>
        </li>
        <li>
          <Link to="/bikes" className="hover:text-red-400">
            Bikes
          </Link>
        </li>
        <li>
          <Link to="/hamburger" className="hover:text-red-400">
            Nav Hamburger
          </Link>
        </li>
      </ul>
    </nav>
  );
}

{
  /* <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/about" element={<About />} />
          <Route path="/bikes" element={<Bikes />} />
        </Routes> */
}
